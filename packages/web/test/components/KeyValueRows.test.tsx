import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { KeyValueRows } from '../../src/components/KeyValueRows';

describe('KeyValueRows', () => {
  it('renders one row per item with its key and value', () => {
    render(
      <KeyValueRows
        label="Variables"
        rows={[{ id: '1', key: 'baseUrl', value: 'https://api.example.com' }]}
        onChange={() => {}}
      />
    );
    expect(screen.getByDisplayValue('baseUrl')).toBeInTheDocument();
    expect(screen.getByDisplayValue('https://api.example.com')).toBeInTheDocument();
  });

  it('calls onChange with a new empty row when Add is clicked', async () => {
    const onChange = vi.fn();
    render(<KeyValueRows label="Variables" rows={[]} onChange={onChange} />);
    await userEvent.click(screen.getByRole('button', { name: 'Add Variables row' }));
    expect(onChange).toHaveBeenCalledTimes(1);
    const newRows = onChange.mock.calls[0][0];
    expect(newRows).toHaveLength(1);
    expect(newRows[0]).toMatchObject({ key: '', value: '' });
  });

  it('calls onChange with the row removed when Remove is clicked', async () => {
    const onChange = vi.fn();
    render(
      <KeyValueRows
        label="Variables"
        rows={[{ id: '1', key: 'baseUrl', value: 'x' }]}
        onChange={onChange}
      />
    );
    await userEvent.click(screen.getByRole('button', { name: 'Remove Variables row' }));
    expect(onChange).toHaveBeenCalledWith([]);
  });

  it('calls onChange with an updated key when the key input changes', () => {
    const onChange = vi.fn();
    render(
      <KeyValueRows label="Variables" rows={[{ id: '1', key: '', value: '' }]} onChange={onChange} />
    );
    fireEvent.change(screen.getByLabelText('Variables key'), { target: { value: 'baseUrl' } });
    expect(onChange).toHaveBeenCalledWith([{ id: '1', key: 'baseUrl', value: '' }]);
  });
});
