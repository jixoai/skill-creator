//#region Host loader entry for the Skill Creator Manager client plugin.
/**
 * Browser-only 骨架（dsh-webui-composition task 1.2）：Manager 的全部能力都在
 * browser half（单一 RPC owner + surfaces）；host 侧随 2.x 的 remote namespace
 * 与 3.1a 的 daemon 桥接入，当前无 Host 行为。
 */
function apply() {}
//#endregion
export { apply };
