import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RequestBuilder, type RequestBuilderProps } from '../../src/components/RequestBuilder';
import type { AuthConfig } from '../../src/types';

function baseProps(overrides: Partial<RequestBuilderProps> = {}): RequestBuilderProps {
  return {
    method: 'GET',
    onMethodChange: vi.fn(),
    url: '',
    onUrlChange: vi.fn(),
    params: [],
    onParamsChange: vi.fn(),
    headers: [],
    onHeadersChange: vi.fn(),
    auth: { type: 'none' } as AuthConfig,
    onAuthChange: vi.fn(),
    body: '',
    onBodyChange: vi.fn(),
    extracts: [],
    onExtractsChange: vi.fn(),
    questions: [],
    onQuestionsChange: vi.fn(),
    ...overrides,
  };
}

describe('RequestBuilder', () => {
  it('calls onMethodChange when the method select changes', async () => {
    const onMethodChange = vi.fn();
    render(<RequestBuilder {...baseProps({ onMethodChange })} />);
    await userEvent.selectOptions(screen.getByLabelText('Method'), 'POST');
    expect(onMethodChange).toHaveBeenCalledWith('POST');
  });

  it('calls onUrlChange as the URL input changes', async () => {
    const onUrlChange = vi.fn();
    render(<RequestBuilder {...baseProps({ onUrlChange })} />);
    await userEvent.type(screen.getByLabelText('URL'), 'x');
    expect(onUrlChange).toHaveBeenCalledWith('x');
  });

  it('shows the Params tab by default', () => {
    render(<RequestBuilder {...baseProps({ params: [{ id: '1', key: 'page', value: '2' }] })} />);
    expect(screen.getByDisplayValue('page')).toBeInTheDocument();
  });

  it('switches to the Headers tab', async () => {
    render(<RequestBuilder {...baseProps({ headers: [{ id: '1', key: 'X-Trace', value: 'abc' }] })} />);
    await userEvent.click(screen.getByRole('button', { name: 'Headers' }));
    expect(screen.getByDisplayValue('X-Trace')).toBeInTheDocument();
  });

  it('switches to the Auth tab and shows the token field for bearer auth', async () => {
    render(<RequestBuilder {...baseProps({ auth: { type: 'bearer', token: 'abc' } })} />);
    await userEvent.click(screen.getByRole('button', { name: 'Auth' }));
    expect(screen.getByLabelText('Token')).toHaveValue('abc');
  });

  it('switches auth type via the Type select, resetting to a blank config', async () => {
    const onAuthChange = vi.fn();
    render(<RequestBuilder {...baseProps({ onAuthChange })} />);
    await userEvent.click(screen.getByRole('button', { name: 'Auth' }));
    await userEvent.selectOptions(screen.getByLabelText('Type'), 'basic');
    expect(onAuthChange).toHaveBeenCalledWith({ type: 'basic', username: '', password: '' });
  });

  it('switches to the Body tab and calls onBodyChange as the textarea changes', async () => {
    const onBodyChange = vi.fn();
    render(<RequestBuilder {...baseProps({ onBodyChange })} />);
    await userEvent.click(screen.getByRole('button', { name: 'Body' }));
    // '{{}' is user-event's escape for a literal '{' — a bare '{' starts a
    // special-key sequence like '{enter}' in its typing DSL.
    await userEvent.type(screen.getByLabelText('Body (JSON)'), '{{}');
    expect(onBodyChange).toHaveBeenCalledWith('{');
  });

  it('switches to the Extract tab and renders ExtractEditor rows', async () => {
    render(
      <RequestBuilder
        {...baseProps({ extracts: [{ id: '1', source: 'status', path: '', rememberAs: 'code' }] })}
      />
    );
    await userEvent.click(screen.getByRole('button', { name: 'Extract' }));
    expect(screen.getByDisplayValue('code')).toBeInTheDocument();
  });

  it('switches to the Questions tab and renders QuestionsEditor rows', async () => {
    render(
      <RequestBuilder
        {...baseProps({ questions: [{ id: '1', source: 'status', path: '', expected: '200' }] })}
      />
    );
    await userEvent.click(screen.getByRole('button', { name: 'Questions' }));
    expect(screen.getByLabelText('Expected value')).toHaveValue('200');
  });
});
