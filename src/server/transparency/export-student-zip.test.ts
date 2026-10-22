import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import JSZip from 'jszip';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mintActor } from '@/server/dal/mint-actor';
import { AuthorizationError } from '@/server/dal/actor-authorization';
import { seedStudentEverywhere, type SeededStudent } from '../../../tests/helpers/seed-student-everywhere';
import { appDb, closeTestDatabases } from '../../../tests/helpers/test-database';
import { buildStudentExportZip, rowsToCsv } from './export-student-zip';
import { REGISTERED_TABLES } from './registry';

let student: SeededStudent;
let other: SeededStudent;

beforeAll(async () => {
  process.env.STORAGE_DIR = await mkdtemp(join(tmpdir(), 'cu-export-'));
  student = await seedStudentEverywhere(appDb());
  other = await seedStudentEverywhere(appDb());
  for (const uri of student.fileUris) {
    const full = join(process.env.STORAGE_DIR, uri.slice('storage:'.length));
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, `nội dung ${uri}`);
  }
});
afterAll(closeTestDatabases);

describe('export zip', () => {
  it('có đủ mọi bảng trong registry (kể cả llm_calls ngoài phiên) và file ảnh, scan consent', async () => {
    const parent = mintActor('parent', student.parentId);
    const { zip, missingFiles } = await buildStudentExportZip(parent, { studentId: student.studentId });
    expect(missingFiles).toEqual([]);
    const archive = await JSZip.loadAsync(zip);

    for (const table of REGISTERED_TABLES) {
      const json = archive.file(`tables/${table}.json`);
      expect(json, table).not.toBeNull();
      expect(archive.file(`tables/${table}.csv`), table).not.toBeNull();
      const rows = JSON.parse(await json!.async('string')) as unknown[];
      // access_log có ít nhất dòng seed; mọi bảng khác đã được seed dữ liệu.
      expect({ table, hasRows: rows.length > 0 }).toEqual({ table, hasRows: true });
    }

    const llmCalls = JSON.parse(await archive.file('tables/llm_calls.json')!.async('string')) as {
      purpose: string;
      session_id: string | null;
    }[];
    expect(llmCalls.some((c) => c.purpose === 'report_narrative' && c.session_id === null)).toBe(true);

    const students = JSON.parse(await archive.file('tables/students.json')!.async('string')) as Record<string, unknown>[];
    expect(students[0]).not.toHaveProperty('pin_hash');

    const fileNames = Object.values(archive.files)
      .filter((f) => !f.dir && f.name.startsWith('files/'))
      .map((f) => f.name);
    expect(fileNames).toHaveLength(3);
  });

  it('chỉ chứa dữ liệu của đúng học sinh', async () => {
    const parent = mintActor('parent', student.parentId);
    const archive = await JSZip.loadAsync((await buildStudentExportZip(parent, { studentId: student.studentId })).zip);
    const sessions = JSON.parse(await archive.file('tables/sessions.json')!.async('string')) as { student_id: string }[];
    expect(sessions.every((s) => s.student_id === student.studentId)).toBe(true);
    const turns = JSON.parse(await archive.file('tables/turns.json')!.async('string')) as { session_id: string }[];
    expect(turns.some((t) => t.session_id === other.sessionId)).toBe(false);
  });

  it('ghi access_log export', async () => {
    const { rows } = await appDb().query(
      `SELECT count(*)::int AS n FROM access_log WHERE student_id = $1 AND action = 'export' AND actor_id = $2`,
      [student.studentId, student.parentId],
    );
    expect(rows[0].n).toBeGreaterThan(0);
  });

  it('phụ huynh không liên kết không export được', async () => {
    const stranger = mintActor('parent', other.parentId);
    await expect(buildStudentExportZip(stranger, { studentId: student.studentId })).rejects.toBeInstanceOf(
      AuthorizationError,
    );
  });

  it('admin không liên kết phải có lý do', async () => {
    await expect(
      buildStudentExportZip(mintActor('admin', other.adminId), { studentId: student.studentId }),
    ).rejects.toBeInstanceOf(AuthorizationError);
    await expect(
      buildStudentExportZip(mintActor('admin', other.adminId, 'hỗ trợ phụ huynh'), { studentId: student.studentId }),
    ).resolves.toBeDefined();
  });

  it('CSV escape dấu phẩy, ngoặc kép, xuống dòng', () => {
    expect(rowsToCsv([{ a: 'x,y', b: 'nói "chào"', c: { n: 1 } }])).toBe(
      '﻿a,b,c\r\n"x,y","nói ""chào""","{""n"":1}"\r\n',
    );
  });
});
