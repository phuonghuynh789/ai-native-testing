import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QuestionsEditor } from '../../src/components/QuestionsEditor';

describe('QuestionsEditor', () => {
  it('adds a new row defaulting to status source', async () => {
    const onChange = vi.fn();
    render(<QuestionsEditor rows={[]} onChange={onChange} />);
    await userEvent.click(screen.getByRole('button', { name: 'Add question row' }));
    const newRows = onChange.mock.calls[0][0];
    expect(newRows[0]).toMatchObject({ source: 'status', path: '', expected: '' });
  });

  it('shows the expected-value input for every source kind', () => {
    render(
      <QuestionsEditor rows={[{ id: '1', source: 'status', path: '', expected: '200' }]} onChange={() => {}} />
    );
    expect(screen.getByLabelText('Expected value')).toHaveValue('200');
  });

  it('calls onChange with an updated expected value', async () => {
    const onChange = vi.fn();
    render(
      <QuestionsEditor rows={[{ id: '1', source: 'status', path: '', expected: '' }]} onChange={onChange} />
    );
    await userEvent.type(screen.getByLabelText('Expected value'), '2');
    expect(onChange).toHaveBeenCalledWith([{ id: '1', source: 'status', path: '', expected: '2' }]);
  });
});
