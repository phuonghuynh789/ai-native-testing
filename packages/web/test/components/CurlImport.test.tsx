import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CurlImport } from '../../src/components/CurlImport';

describe('CurlImport', () => {
  it('disables Import when the textarea is empty', () => {
    render(<CurlImport onImport={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Import' })).toBeDisabled();
  });

  it('calls onImport with the parsed result for a valid command', async () => {
    const onImport = vi.fn();
    render(<CurlImport onImport={onImport} />);
    fireEvent.change(screen.getByLabelText('cURL command'), {
      target: {
        value: `curl -X POST https://api.example.com/x -H 'Content-Type: application/json' -d '{"a":1}'`,
      },
    });
    await userEvent.click(screen.getByRole('button', { name: 'Import' }));
    expect(onImport).toHaveBeenCalledWith({
      method: 'POST',
      url: 'https://api.example.com/x',
      headers: [{ id: expect.any(String), key: 'Content-Type', value: 'application/json' }],
      body: '{"a":1}',
    });
    expect(screen.getByText('Imported.')).toBeInTheDocument();
  });

  it('shows an error and does not call onImport for an invalid command', async () => {
    const onImport = vi.fn();
    render(<CurlImport onImport={onImport} />);
    fireEvent.change(screen.getByLabelText('cURL command'), {
      target: { value: 'wget https://api.example.com/x' },
    });
    await userEvent.click(screen.getByRole('button', { name: 'Import' }));
    expect(onImport).not.toHaveBeenCalled();
    expect(screen.getByText('Command must start with "curl"')).toBeInTheDocument();
  });

  it('keeps the textarea text after a successful import', async () => {
    render(<CurlImport onImport={vi.fn()} />);
    const textarea = screen.getByLabelText('cURL command');
    fireEvent.change(textarea, { target: { value: 'curl https://api.example.com/x' } });
    await userEvent.click(screen.getByRole('button', { name: 'Import' }));
    expect(textarea).toHaveValue('curl https://api.example.com/x');
  });
});
