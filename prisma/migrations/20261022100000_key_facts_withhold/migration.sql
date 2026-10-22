-- Chữ Mít không được nói khi con chưa nêu ý chính (kiểm tra cứng LEAK, môn kiến thức).
ALTER TABLE "key_facts" ADD COLUMN "withhold" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
