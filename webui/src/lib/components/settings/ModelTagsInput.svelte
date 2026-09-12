<!--
  模型 tags-input（迭代五 2026-09-12）。
  用户原始需求 [2026-09-12]：「Models (comma-separated) 这类输入框升级成
  tags-input，并且支持自动补全，可用模型就从 models.dev 提供的数据上拉取。」
  用户原始需求 [2026-09-12 R12-A]：「effect 点击的时候会导致误删：Focus 然后
  blur 就会触发」——chip 主体点击不得删除（label 激活误删修复，见 DOM 注释）。
  正交意图：
  1. tag 编辑：chips + 输入框同域；Enter/逗号确认、Backspace 删尾、× 删除。
  2. 自动补全：候选（该 provider 的目录模型，含 vision 标记）按输入过滤；
     已选置灰；键盘 ↑↓ 导航 + Esc 关闭。
  3. 受控：selected 双向（父级 Set 重建赋值），任意来源（补全/手输）统一去重；
     × 删除只认对自身按钮的直接点击，chip 主体点击/聚焦/失焦永不删除。
-->
<script lang="ts">
  interface Props {
    selected: string[];
    candidates: Array<{ id: string; name?: string; image?: boolean }>;
    placeholder?: string;
    onchange: (selected: string[]) => void;
    disabled?: boolean;
  }

  let {
    selected,
    candidates,
    placeholder = "Add model…",
    onchange,
    disabled = false,
  }: Props = $props();

  let input = $state("");
  let open = $state(false);
  let highlight = $state(0);

  const filtered = $derived.by(() => {
    const needle = input.trim().toLowerCase();
    const pool = candidates.filter((entry) => !selected.includes(entry.id));
    if (needle.length === 0) return pool.slice(0, 8);
    return pool
      .filter(
        (entry) =>
          entry.id.toLowerCase().includes(needle) ||
          (entry.name ?? "").toLowerCase().includes(needle),
      )
      .slice(0, 8);
  });

  function commit(value: string): void {
    const id = value.trim();
    if (id.length === 0 || selected.includes(id)) {
      input = "";
      return;
    }
    onchange([...selected, id]);
    input = "";
    open = false;
  }

  function remove(id: string): void {
    onchange(selected.filter((entry) => entry !== id));
  }

  function onKeydown(event: KeyboardEvent): void {
    if (event.key === "Escape") {
      open = false;
      return;
    }
    if (event.key === "ArrowDown" && filtered.length > 0) {
      event.preventDefault();
      open = true;
      highlight = Math.min(highlight + 1, filtered.length - 1);
      return;
    }
    if (event.key === "ArrowUp" && filtered.length > 0) {
      event.preventDefault();
      highlight = Math.max(highlight - 1, 0);
      return;
    }
    if (event.key === "Enter" || event.key === ",") {
      event.preventDefault();
      if (open && filtered[highlight] && input.trim().length > 0) commit(filtered[highlight]!.id);
      else if (input.trim().length > 0) commit(input);
      return;
    }
    if (event.key === "Backspace" && input.length === 0 && selected.length > 0) {
      onchange(selected.slice(0, -1));
    }
  }
</script>

<div class="relative">
  <div
    class="flex min-h-8 flex-wrap items-center gap-1 rounded-md border border-border bg-background px-1.5 py-1 text-xs focus-within:border-primary/60"
    role="group"
    aria-label="Model ids"
  >
    <!-- R12-A1：input 在 DOM 里先于 chips（labelable 顺序）——若本组件未来再次被
         <label> 包裹，label 激活只会聚焦输入框而不是合成点击第一枚 × 误删 chip；
         视觉顺序由 order-last 保持「chips 在前、输入收尾」不变。 -->
    <input
      class="order-last h-6 min-w-24 flex-1 bg-transparent text-xs outline-none"
      {placeholder}
      {disabled}
      bind:value={input}
      onkeydown={onKeydown}
      onfocus={() => {
        open = true;
        highlight = 0;
      }}
      oninput={() => {
        open = true;
        highlight = 0;
      }}
      onblur={() => setTimeout(() => (open = false), 120)}
    />
    {#each selected as id (id)}
      <span class="flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-[10px]">
        {id}
        <button
          type="button"
          class="rounded px-0.5 text-muted-foreground hover:text-destructive"
          aria-label="Remove {id}"
          {disabled}
          onclick={() => remove(id)}
        >
          ×
        </button>
      </span>
    {/each}
  </div>
  {#if open && filtered.length > 0}
    <ul
      class="absolute z-10 mt-1 max-h-44 w-full overflow-y-auto rounded-md border border-border bg-popover p-1 text-xs shadow-md"
      role="listbox"
      aria-label="Model suggestions"
    >
      {#each filtered as entry, index (entry.id)}
        <li>
          <button
            class="flex w-full items-center gap-2 rounded px-1.5 py-1 text-left {index === highlight
              ? 'bg-accent'
              : ''} hover:bg-accent"
            role="option"
            aria-selected={index === highlight}
            onmousedown={(event) => event.preventDefault()}
            onclick={() => commit(entry.id)}
            onfocus={() => (highlight = index)}
          >
            <span class="min-w-0 flex-1 truncate">
              {entry.name ?? entry.id}
              <span class="text-muted-foreground">({entry.id})</span>
            </span>
            {#if entry.image}
              <span class="shrink-0 rounded bg-primary/10 px-1 text-[9px] text-primary">vision</span
              >
            {/if}
          </button>
        </li>
      {/each}
    </ul>
  {/if}
</div>
