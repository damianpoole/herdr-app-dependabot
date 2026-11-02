// Migrate only this package's blocks; retain other mods and panel selection.
export function integrateLayout(input) {
  const tree = structuredClone(input);
  const nodes = new Map();
  function scan(node) {
    if (!node || typeof node !== "object") return;
    if (node.id) {
      if (nodes.has(node.id)) throw new Error(`Duplicate layout id: ${node.id}`);
      nodes.set(node.id, node);
    }
    for (const child of node.children ?? []) scan(child);
    for (const child of node.floating ?? []) scan(child);
  }
  scan(tree);
  for (const [id, role] of [
    ["dependabot-strip", "strip"],
    ["dependabot-panel", "panel"],
  ]) {
    const node = nodes.get(id);
    if (node && (node.content?.mod !== "dependabot" || node.content?.props?.role !== role))
      throw new Error(`Layout id ${id} belongs to another block`);
  }
  const footer = nodes.get("sidebar-footer");
  const mod = footer?.content?.mod;
  const managed = mod === "dependabot" && footer.content.props?.role === "footer";
  const tasks = mod === "obsidian-tasks-footer" || (managed && footer.content.props.tasks === true);
  if (
    !footer ||
    footer.type !== "block" ||
    !(managed || tasks || (mod === "workspace-chrome" && footer.content.props?.footer))
  )
    throw new Error(
      "No supported sidebar-footer found; use the Tasks footer or standard Settings footer",
    );
  function removeOld(node) {
    for (const key of ["children", "floating"]) {
      if (!node[key]) continue;
      node[key] = node[key].filter(
        (child) => !["dependabot-strip", "dependabot-panel"].includes(child.id),
      );
      if (["dependabot-strip", "dependabot-panel"].includes(node.active)) {
        if (node[key].length) node.active = node[key][0].id;
        else delete node.active;
      }
      node[key].forEach(removeOld);
    }
  }
  removeOld(tree);
  footer.content = { mod: "dependabot", props: { role: "footer", tasks } };
  footer.size = { px: tasks ? 125 : 97 };
  return tree;
}
