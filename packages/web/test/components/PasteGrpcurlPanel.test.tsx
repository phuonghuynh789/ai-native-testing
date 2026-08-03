import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PasteGrpcurlPanel } from '../../src/components/PasteGrpcurlPanel';

describe('PasteGrpcurlPanel', () => {
  it('disables Import when the textarea is empty', () => {
    render(<PasteGrpcurlPanel onImport={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Import' })).toBeDisabled();
  });

  it('calls onImport with the parsed result for a valid command', async () => {
    const onImport = vi.fn();
    render(<PasteGrpcurlPanel onImport={onImport} />);
    await userEvent.type(
      screen.getByLabelText('grpcurl command'),
      'grpcurl localhost:50051 payment.PaymentService/CreatePayment'
    );
    await userEvent.click(screen.getByRole('button', { name: 'Import' }));
    expect(onImport).toHaveBeenCalledWith({
      serverAddress: 'localhost:50051',
      service: 'PaymentService',
      method: 'CreatePayment',
      message: '',
      metadata: [],
      secure: true,
      skipCertVerification: false,
    });
    expect(screen.getByText('Imported.')).toBeInTheDocument();
  });

  it('shows an error and does not call onImport for an invalid command', async () => {
    const onImport = vi.fn();
    render(<PasteGrpcurlPanel onImport={onImport} />);
    await userEvent.type(screen.getByLabelText('grpcurl command'), 'not a grpcurl command');
    await userEvent.click(screen.getByRole('button', { name: 'Import' }));
    expect(onImport).not.toHaveBeenCalled();
    expect(screen.getByText('Command must start with "grpcurl"')).toBeInTheDocument();
  });

  it('keeps the textarea text after a successful import', async () => {
    render(<PasteGrpcurlPanel onImport={vi.fn()} />);
    const textarea = screen.getByLabelText('grpcurl command');
    await userEvent.type(textarea, 'grpcurl localhost:50051 payment.PaymentService/CreatePayment');
    await userEvent.click(screen.getByRole('button', { name: 'Import' }));
    expect(textarea).toHaveValue('grpcurl localhost:50051 payment.PaymentService/CreatePayment');
  });
});
