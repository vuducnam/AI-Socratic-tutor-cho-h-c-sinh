// Ngược lại của renderPrompt: từ một template và bản đã render, lấy lại giá trị từng biến {ten}.
// Dùng cho eval:replay (render lại yêu cầu cũ bằng prompt mới). Template có phần ổn định và phần thay đổi mỗi
// lượt ngăn bởi marker; bản render lưu thành hai khối đã trim, nên so từng phần với từng khối.
// Biến lặp lại nhiều lần (ví dụ {max_sentences}) phải có cùng giá trị ở mọi chỗ (backreference).

const VARIABLE = /\{([A-Za-z_][A-Za-z0-9_.]*)\}/g;
const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function matchPart(template: string, rendered: string, into: Record<string, string>): boolean {
  const groupOf = new Map<string, string>();
  let pattern = '';
  let last = 0;
  for (const m of template.matchAll(VARIABLE)) {
    pattern += escapeRegex(template.slice(last, m.index));
    const name = m[1]!;
    const seen = groupOf.get(name);
    if (seen) pattern += `\\k<${seen}>`;
    else {
      const group = `v${groupOf.size}`;
      groupOf.set(name, group);
      pattern += `(?<${group}>[\\s\\S]*?)`;
    }
    last = m.index! + m[0].length;
  }
  pattern += escapeRegex(template.slice(last));
  const found = new RegExp(`^${pattern}$`, 'u').exec(rendered);
  if (!found) return false;
  for (const [name, group] of groupOf) into[name] = found.groups![group]!;
  return true;
}

export function extractPromptVariables(template: string, blocks: string[], marker: string): Record<string, string> | null {
  const parts = template.split(marker).map((p) => p.trim());
  if (parts.length !== blocks.length) return null;
  const vars: Record<string, string> = {};
  return parts.every((part, i) => matchPart(part, blocks[i]!.trim(), vars)) ? vars : null;
}
