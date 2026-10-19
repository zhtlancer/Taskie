import { test } from 'node:test';
import assert from 'node:assert/strict';
import { courseLabel } from '../src/utils/homework.js';

test('a deleted outside class reads apart from a live class of the same name', () => {
  // Records carry course_kind; summary rows carry kind.
  assert.equal(courseLabel({ course_kind: 'class', subject: '钢琴课', class_id: 'c1' }), '钢琴课');
  assert.equal(courseLabel({ course_kind: 'class', subject: '钢琴课', class_id: null }), '钢琴课（已删除）');
  assert.equal(courseLabel({ kind: 'class', subject: '钢琴课', class_id: 'c1' }), '钢琴课');
  assert.equal(courseLabel({ kind: 'class', subject: '钢琴课', class_id: null }), '钢琴课（已删除）');
  // School subjects never have a class.
  assert.equal(courseLabel({ course_kind: 'school', subject: '数学', class_id: null }), '数学');
  assert.equal(courseLabel({ kind: 'school', subject: '数学', class_id: null }), '数学');
});
