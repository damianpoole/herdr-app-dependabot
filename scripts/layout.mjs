// Pure transformation: retain every existing node and selection.
export function integrateLayout(input) {
  const tree = structuredClone(input);
  const nodes = new Map();
  const parents = new Map();
  function scan(node, parent) {
    if (!node || typeof node !== "object") return;
    if (node.id) {
      if (nodes.has(node.id)) throw new Error(`Duplicate layout id: ${node.id}`);
      nodes.set(node.id, node);
      parents.set(node.id, parent);
    }
    for (const child of node.children ?? []) scan(child, node);
    for (const child of node.floating ?? []) scan(child, node);
  }
  scan(tree);
  const panel = nodes.get("panel-body");
  for (const [id, role] of [
    ["dependabot-strip", "strip"],
    ["dependabot-panel", "panel"],
  ]) {
    const existing = nodes.get(id);
    if (
      existing &&
      (existing.type !== "block" ||
        existing.content?.mod !== "dependabot" ||
        existing.content?.props?.role !== role ||
        (role === "panel" && (panel?.type !== "stack" || parents.get(id) !== panel)))
    ) {
      throw new Error(`Layout id ${id} belongs to another block or location`);
    }
  }
  const block = (id, role) => ({
    id,
    type: "block",
    content: { mod: "dependabot", props: { role } },
  });
  if (!nodes.has("dependabot-strip")) {
    let inserted = false;
    function insert(node) {
      if (!node || inserted) return;
      const children = node.children ?? [];
      const tabs = children.findIndex(
        (child) => child.id === "tabs" || child.content?.mod === "tabs",
      );
      if (tabs >= 0 && node.type === "column") {
        children.splice(tabs + 1, 0, { ...block("dependabot-strip", "strip"), size: { px: 40 } });
        inserted = true;
        return;
      }
      for (const child of children) insert(child);
    }
    insert(tree);
    if (!inserted)
      throw new Error("No tabs block in a column found; add the Dependabot launcher manually");
  }
  if (panel?.type === "stack" && !nodes.has("dependabot-panel")) {
    panel.children ??= [];
    panel.children.push(block("dependabot-panel", "panel"));
  }
  return tree;
}
