import 'server-only';
import JSZip from 'jszip';
import type { Actor } from '@/server/dal/actor';
import type { RequestContext } from '@/server/dal/access-log-dal';
import { readStudentExport, type ExportRow } from '@/server/dal/export-dal';
import { readStorageFile } from '@/server/storage/local-file-storage';
import { TransparencyRegistry, type TableName } from './registry';

// Export toàn bộ dữ liệu của một học sinh: mỗi bảng một file JSON + CSV, kèm thư mục files/ chứa
// ảnh đề, ảnh nhiệm vụ, bản scan consent (quy tắc cứng 2 gồm cả file, không chỉ bảng).

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  const text = typeof value === 'object' ? JSON.stringify(value) : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function rowsToCsv(rows: ExportRow[]): string {
  const columns = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  const lines = [columns.map(csvCell).join(',')];
  for (const row of rows) lines.push(columns.map((c) => csvCell(row[c])).join(','));
  // BOM để Excel mở đúng tiếng Việt.
  return `﻿${lines.join('\r\n')}\r\n`;
}

function storagePathInZip(uri: string): string {
  return `files/${uri.replace(/^storage:/, '').replace(/[^\p{L}\p{N}._/-]/gu, '_')}`;
}

export interface StudentExportResult {
  zip: Uint8Array;
  missingFiles: string[];
}

export async function buildStudentExportZip(
  actor: Actor,
  { studentId, request }: { studentId: string; request?: RequestContext },
): Promise<StudentExportResult> {
  const tables = await readStudentExport(actor, { studentId, request });
  const zip = new JSZip();
  const missingFiles: string[] = [];
  const fileUris = new Set<string>();

  for (const [table, rows] of Object.entries(tables) as [TableName, ExportRow[]][]) {
    zip.file(`tables/${table}.json`, JSON.stringify(rows, null, 2));
    zip.file(`tables/${table}.csv`, rowsToCsv(rows));
    const entry = TransparencyRegistry[table];
    if ('fileColumns' in entry) {
      for (const row of rows) {
        for (const col of entry.fileColumns) {
          const uri = row[col];
          if (typeof uri === 'string' && uri) fileUris.add(uri);
        }
      }
    }
  }

  for (const uri of fileUris) {
    try {
      zip.file(storagePathInZip(uri), await readStorageFile(uri));
    } catch {
      missingFiles.push(uri);
    }
  }

  zip.file(
    'README.txt',
    [
      'Dữ liệu của học sinh trong Mít, xuất theo TransparencyRegistry.',
      'tables/*.json, tables/*.csv: mỗi bảng một file. files/: ảnh đề, ảnh nhiệm vụ, bản scan đồng ý.',
      'Không có hash mật khẩu, PIN hay token thiết bị.',
      missingFiles.length ? `File không đọc được: ${missingFiles.join(', ')}` : 'Đủ mọi file.',
      `Xuất lúc: ${new Date().toISOString()}`,
    ].join('\n'),
  );

  return { zip: await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' }), missingFiles };
}
