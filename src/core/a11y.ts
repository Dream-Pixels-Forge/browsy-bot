// Accessibility tree audit — read the live accessibility tree over CDP.
//
// Flow:
//   1. Accessibility.enable
//   2. Accessibility.getFullAXTree -> raw AX nodes
//   3. Filter to role/name/value/state/description for a compact, usable tree
//
// Returns a simplified array of AX nodes with role, name, value, description,
// and relevant state properties.

import { CDPConnection } from './connection.js';
import { Accessibility } from './types.js';
import type { Session } from './session.js';

type Conn = CDPConnection;

interface SimpleAXNode {
  nodeId: number;
  role?: string | number | boolean;
  name?: string | number | boolean;
  value?: string | number | boolean;
  description?: string | number | boolean;
  checked?: string | number | boolean;
  disabled?: string | number | boolean;
  focused?: string | number | boolean;
  expanded?: string | number | boolean;
  selected?: string | number | boolean;
  [key: string]: unknown;
}

function simplifyNode(node: Accessibility.AXNode): SimpleAXNode {
  const getProp = (p?: Accessibility.AXProperty | Accessibility.AXProperty[]) => {
    if (!p) return undefined;
    const arr = Array.isArray(p) ? p : [p];
    return arr.length > 0 ? arr[0].value : undefined;
  };

  const out: SimpleAXNode = { nodeId: Number(node.nodeId) };
  if (node.role) out.role = getProp(node.role);
  if (node.name) out.name = getProp(node.name);
  if (node.value) out.value = node.value.value;
  if (node.description) out.description = getProp(node.description);
  if (node.checked !== undefined) out.checked = getProp(node.checked);
  if (node.disabled !== undefined) out.disabled = getProp(node.disabled);
  if (node.focused !== undefined) out.focused = getProp(node.focused);
  if (node.expanded !== undefined) out.expanded = getProp(node.expanded);
  if (node.selected !== undefined) out.selected = getProp(node.selected);
  return out;
}

/** Return the live accessibility tree, simplified to role/name/value/state. */
export async function getAccessibilityTree(session: Session): Promise<SimpleAXNode[]> {
  const conn = await session.page();
  await conn.send('Accessibility.enable');
  const result = await conn.send<Accessibility.GetFullAXTreeResult>(
    'Accessibility.getFullAXTree',
    {},
  );
  return (result.nodes ?? []).map(simplifyNode);
}
