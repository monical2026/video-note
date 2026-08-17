// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/preact';
import { SummaryView } from './SummaryView';
import type { Summary } from '../../src/types';

const s: Summary = {
  videoId: 'v', oneLiner: '讲透闭包',
  sections: [{ start: 192, title: '定义', points: ['闭包=函数+词法环境'] }],
  knowledge: [{ term: 'closure', desc: '函数+词法环境' }], prerequisites: ['作用域'],
  model: 'm', generatedAt: 1,
};

it('渲染结构化摘要，时间戳可点跳转', () => {
  const sendMsg = vi.fn(async () => ({}));
  vi.stubGlobal('browser', { runtime: { sendMessage: sendMsg }, tabs: { create: vi.fn() } });
  const { getByText } = render(<SummaryView summary={s} llmConfigured onSeek={() => {}} />);
  expect(getByText('讲透闭包')).toBeTruthy();
  expect(getByText('定义')).toBeTruthy();
  expect(getByText('作用域')).toBeTruthy();
});

it('未配 LLM 时禁用生成按钮', () => {
  const { getByRole } = render(<SummaryView summary={null} llmConfigured={false} onSeek={() => {}} />);
  expect((getByRole('button') as HTMLButtonElement).disabled).toBe(true);
});
