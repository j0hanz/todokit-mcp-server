import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';

import {
  addTodos,
  deleteTodo,
  getTodos,
  updateTodo,
} from '../src/lib/storage.js';

const SAMPLE_SIZE = 200;
const LABEL_WIDTH = 10;

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(
    sorted.length - 1,
    Math.ceil((p / 100) * sorted.length) - 1
  );
  return sorted[Math.max(0, index)] ?? 0;
}

function logMetric(label: string, value: number): void {
  const padded = label.padEnd(LABEL_WIDTH, ' ');
  console.log(`${padded}${value.toFixed(2)} ms`);
}

async function runBench(): Promise<void> {
  const tempDir = await mkdtemp(join(tmpdir(), 'todokit-bench-'));
  process.env.TODOKIT_TODO_FILE = join(tempDir, 'todos.json');

  const seedItems = Array.from({ length: SAMPLE_SIZE }, (_, index) => ({
    title: `Bench ${index}`,
    description: `Desc ${index}`,
    priority: index % 2 === 0 ? 'high' : 'normal',
    dueDate: index % 3 === 0 ? '2025-01-15' : undefined,
    tags: index % 5 === 0 ? ['bench'] : [],
  }));

  const addDurations: number[] = [];
  const listDurations: number[] = [];
  const updateDurations: number[] = [];
  const deleteDurations: number[] = [];

  const memoryBefore = process.memoryUsage().rss / 1024 / 1024;

  const addStart = performance.now();
  await addTodos(seedItems);
  addDurations.push(performance.now() - addStart);

  for (let i = 0; i < SAMPLE_SIZE; i += 1) {
    const start = performance.now();
    await getTodos({ query: 'Bench' });
    listDurations.push(performance.now() - start);
  }

  const todos = await getTodos();
  for (const todo of todos) {
    const start = performance.now();
    await updateTodo(todo.id, { priority: 'low' });
    updateDurations.push(performance.now() - start);
  }

  for (const todo of todos) {
    const start = performance.now();
    await deleteTodo(todo.id);
    deleteDurations.push(performance.now() - start);
  }

  const memoryAfter = process.memoryUsage().rss / 1024 / 1024;

  console.log('Benchmark p95 (ms)');
  logMetric('add', percentile(addDurations, 95));
  logMetric('list', percentile(listDurations, 95));
  logMetric('update', percentile(updateDurations, 95));
  logMetric('delete', percentile(deleteDurations, 95));
  console.log(`Memory delta: ${(memoryAfter - memoryBefore).toFixed(2)} MB`);

  await rm(tempDir, { recursive: true, force: true });
}

runBench().catch((error: unknown) => {
  console.error('Benchmark error:', error);
  process.exit(1);
});
