-- Ý chính từng bài của môn kiến thức (SPEC §5d). Dữ liệu chương trình, không phải dữ liệu học sinh
-- (NON_STUDENT_TABLES). Quyền cu_app đến từ ALTER DEFAULT PRIVILEGES ở migration grants.

-- CreateTable
CREATE TABLE "key_facts" (
    "fact_id" TEXT NOT NULL,
    "lesson_id" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "statement" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "accept" TEXT[],
    "pages" TEXT NOT NULL,
    "locator" TEXT NOT NULL,
    "content_hash" TEXT NOT NULL,
    "approved_by" UUID,
    "approved_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "key_facts_pkey" PRIMARY KEY ("fact_id")
);

-- CreateIndex
CREATE INDEX "key_facts_lesson_id_idx" ON "key_facts"("lesson_id");

-- AddForeignKey
ALTER TABLE "key_facts" ADD CONSTRAINT "key_facts_lesson_id_fkey" FOREIGN KEY ("lesson_id") REFERENCES "curriculum_lessons"("lesson_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "key_facts" ADD CONSTRAINT "key_facts_approved_by_fkey" FOREIGN KEY ("approved_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE key_facts ADD CONSTRAINT key_facts_kind_check
  CHECK (kind IN ('date', 'place', 'person', 'event', 'cause', 'result', 'feature', 'figure', 'symbol'));
ALTER TABLE key_facts ADD CONSTRAINT key_facts_accept_not_empty CHECK (cardinality(accept) > 0);
