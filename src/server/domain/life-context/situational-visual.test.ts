import { describe, expect, it } from 'vitest';
import { situationalVisual } from './generate-situational-problem';

// Hình minh hoạ đề tình huống không được nói sai toán: khác đơn vị (3 m và 7 dm) thì không vẽ chung một thang.

describe('situationalVisual', () => {
  it('cùng đơn vị → sơ đồ đoạn thẳng, mỗi mục giữ đơn vị của mình', () => {
    const v = situationalVisual(
      { svg_kind: 'segment_bar', variables: { a: { unit: 'm', label: 'An' }, b: { unit: 'm', label: 'Bình' } } },
      { a: '3.25', b: '3.4' },
    );
    expect(v).toEqual({ kind: 'segment_bar', items: [{ label: 'An', value: 3.25, unit: 'm' }, { label: 'Bình', value: 3.4, unit: 'm' }] });
  });

  it('khác đơn vị (3 m và 7 dm) → không vẽ', () => {
    expect(situationalVisual({ svg_kind: 'segment_bar', variables: { a: { unit: 'm' }, b: { unit: 'dm' } } }, { a: '3', b: '7' })).toBeNull();
  });

  it('template không có hình → không vẽ', () => {
    expect(situationalVisual({ svg_kind: 'none', variables: { a: { unit: 'kg' } } }, { a: '2' })).toBeNull();
  });
});
