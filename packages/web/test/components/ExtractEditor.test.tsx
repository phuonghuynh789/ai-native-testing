import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ExtractEditor } from '../../src/components/ExtractEditor';

describe('ExtractEditor', () => {
  it('adds a new row defaulting to jsonPath source', async () => {
    const onChange = vi.fn();
    render(<ExtractEditor rows={[]} onChange={onChange} />);
    await userEvent.click(screen.getByRole('button', { name: 'Add extract row' }));
    const newRows = onChange.mock.calls[0][0];
    expect(newRows[0]).toMatchObject({ source: 'jsonPath', path: '', rememberAs: '' });
  });

  it('hides the path input when source is status', () => {
    render(
      <ExtractEditor rows={[{ id: '1', source: 'status', path: '', rememberAs: 'code' }]} onChange={() => {}} />
    );
    expect(screen.queryByLabelText('Extract path')).not.toBeInTheDocument();
  });

  it('shows the path input when source is jsonPath', () => {
    render(
      <ExtractEditor
        rows={[{ id: '1', source: 'jsonPath', path: '$.data.id', rememberAs: 'id' }]}
        onChange={() => {}}
      />
    );
    expect(screen.getByLabelText('Extract path')).toHaveValue('$.data.id');
  });

  it('calls onChange with the row removed', async () => {
    const onChange = vi.fn();
    render(
      <ExtractEditor
        rows={[{ id: '1', source: 'status', path: '', rememberAs: 'code' }]}
        onChange={onChange}
      />
    );
    await userEvent.click(screen.getByRole('button', { name: 'Remove extract row' }));
    expect(onChange).toHaveBeenCalledWith([]);
  });
});
