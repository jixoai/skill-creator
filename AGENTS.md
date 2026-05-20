任务必读资料：

1. `/Users/kzf/.claude/agents/doc-downloader.md`
2. `/Users/kzf/.claude/plugins/skills/skill-creator/SKILL.md`

`doc-downloader`是我之前创建了一个 subagents。它的作用是下载 context7 的文档，到一个
`.claude/references`
文件夹中。现在，claude-code 支持了 skills，那么我觉得我们可以对这个 subagetns 进行升级：

升级成一个 `skill-creater` 的 subagents：

1. **skill-creator**
   - 现在更加可靠，直接使用预设好的脚本程序去进行执行下载，而不再是让 AI 自己去临时执行脚本去做下载
   - 使用 TypeScript + ESM 模块，提供完整的类型安全
   - 集成了 ChromaDB 向量搜索，提供智能文档检索能力
   - **新增 --force 选项**：支持强制覆盖已存在的技能文件
   - **默认非交互模式**：命令默认非交互执行，通过 --interactive 启用交互
1. 它不再是产生在 `.claude/references`
   目录下， 而是基于 claude-code-skills 的规范，产生在当前项目文件夹（`./.claude/skills/`）或者用户目录(`~/.claude/skills`) 下，
1. 然后请你参考 `skill-creator`
   的规范，同时依赖于文档，去构建我们的 claude-code-skills:

1. 在新建 skill 的时候，需要询问用户，是要存储在 当前项目文件夹 还是 用户目录下。
1. 我们需要为我们新建的 skill 配套一些脚本来实现搜索查找，目的不是让 AI 直接读取一整个 zod 文档：
   1. 我们需要将资料文件下载到 `{skill-name}/assets/references/`
      文件夹中，而不是 `{skill-name}/references/` 文件夹
   1. 因为我们下载的是 context7 的文档，所以它的文档具有规律，可以轻松切片
      > _未来我们可能会引入其它的文档生成器，比如甚至是直接 clone 某个仓库，然后根据源代码，去生成一些使用资料。_
      1. 要切成一个个 `.md` 文件，不能是一个巨大的文件。文件名不限制，可以是
         `0001.md`
         ，也可以基于内容中的标题去做`[TITLE].01.md`（这里`.01`是为了避免 TITLE 一样导致的冲突）。这里文件名的规范不重要，只要确保唯一就行。
      1. 切片完成的要放在 `{skill-name}/assets/references/context7/*.md` 中
      1. 因为我们还会有 `{skill-name}/assets/references/user/*.md`
         文件夹，是用户自己使用习惯生成的一些资料
   1. 我们需要内置 search(js+Chroma) 脚本，来提供资料搜索的能力：
      1. 在执行 search 脚本去执行 Chroma 搜索的时候，需要做一些准备工作：
      1. 要确保已经为资料数据做好来索引构建。注意，这里会基于`{skill-name}/assets/references/`文件夹的文件元数据做 fast-hash，如果 fast-hash 变了，那么就需要重新构建索引。
      1. 存储到 Chroma 中的切片数据的内容要包含引用来源
      1. 最终查询出来的数据要提出引用来源
   1. 我们需要内置 add(js) 脚本，能做到动态添加 `assets/references/user`
      中。
      1. user 的优先级高于 context7 优先级
      1. 添加之前，需要先执行 search，找到相似的资料，如果找到高度相似的内容，那么要判断是否属于升级知识点。
         1. 如果已存在的资料都知识点足够丰富，那么我们就不需要更新。结束 add 程序
         1. 如果已经存在的资料知识点相对成就，我们我们需要继续；：
         1. 因为资料中包含了引用来源，所以我们知道资料是否是来自 user 文件夹
         1. 如果是来自 user 文件夹，那么可以直接读取文件，对内容进行更新
         1. 如果内容不是来自 user（来自 context7），因为我们不能修改 context7 文件夹的内容，所以我们需要在 user 文件夹下创建一个新的`.md`文件来写入知识
      1. 添加完成后，因为下一次执行 search 的时候，会自动根据 fast-hash 去判断是否要重新构建或者更新索引，所以我们可以确保可以 search 出最新的知识内容。

---

**具体流程**：

- 首先，本项目是一个nodejs项目，目的是提供“可靠工具”（可以理解成CLI工具，下文简称 cli）。
- 如果有源代码，那么可以用 `npm link` 的方式来挂载，方便本地测试。
- 本项目可以通过 `npm install -g skill-creator` 来下载运行“可靠工具”。

1. **安装 subagent (可选)**:
   如果需要，可以使用 `cli init-cc` 来将 `templates/skill-creator.md` 安装为 `~/.claude/agents/` 目录下的 subagent。

2. **Subagent 工作流**:
   接下来，subagent 将严格遵循 `skill-creator.md` 中定义的流程来工作，该流程的核心步骤如下：
   1. **搜索包**: 根据用户需求，通过 `cli search "KEYWORDS"` 来搜索 npm 包。如果结果不唯一，AI 需要向用户确认。
   2. **获取包信息**: 针对选定的包，运行 `cli get-info @package/name`。这将返回一个包含 `skill_dir_name`, `name`, `version`, `homepage`, `repo` 等信息的 JSON 对象。
   3. **创建技能**: AI 根据 `get-info` 的结果，确认存储位置后，调用 `cli create-cc-skill --scope [current|user] --name <package_name> skill_dir_name --description "..."` 来创建技能目录和基础文件。
      **注意**:
   - `--scope` 是必须参数，必须指定存储位置（current表示当前项目，user表示用户目录）
   - `--name` 是推荐参数，指定包名，避免从目录名猜测
   4. **获取文档 ID**: AI 调用 `cli resolve-context7 <package_name> [--package-version <version>]` 来搜索并根据 `skill-creator.md` 中定义的评判标准确定唯一的 `project-id`。命令输出中的 `bestMatch.id` 就是下一步要使用的 `project-id`。
   5. **下载文档**: 使用 `cli download-context7 --pwd <skill_path> <project_id>` 命令来下载文档。`<skill_path>` 是上一步创建技能时返回的完整路径。文档将被自动切分并存放到 `{skill_path}/assets/references/context7/` 目录下。
   6. **添加用户知识**: subagent 可以通过 `cli add-skill --pwd <skill_path> --title "标题" --content "内容"` 来动态添加用户自定义的知识点。
   7. **搜索知识**: subagent 可以使用 `cli search-skill --pwd <skill_path> "查询关键词"` 来在技能的知识库中进行搜索。
   8. **强制更新文档**: 可以通过添加 `--force` 标志来强制更新 Context7 文档，例如 `skill-creator download-context7 --pwd <skill_path> <project_id> --force`。这会重新下载并覆盖已存在的 Context7 文档文件。

---

**工作内容**：

1. 请你根据"具体流程"，确定每一个工具都按照预期完成了开发并通过了测试；并且确定`templates/skill-creator.md`提示词符合预期
2. 如果通过了测试，请自己调用 subagents，让subagetns根据规范执行调用工具，在这个过程中验证整个流程是否符合预期地工作。
3. 一旦有任何错误，请反思并修复流程中的错误(可能是subagents的提示词错误，可能是cli工具的错误)，并确保测试和类型检查再次通过，然后重复步骤2。
4. 如果执行通过，要在此确认，整个执行流程是否符合“具体流程”，否则回到步骤1。
5. 最后请你清理无关的代码文件。进行git-commit+push
