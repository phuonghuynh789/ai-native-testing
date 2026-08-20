import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Sidebar } from '../../src/components/Sidebar';

function renderSidebar(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <Sidebar />
    </MemoryRouter>
  );
}

const ALL_LINKS = [
  'Simple Mode',
  'Manage Load Reusable Step',
  'End-to-end test',
  'API Automation',
  'Check Kafka',
  'Kafka Contract Checks',
  'Sprint Report',
];

const LINK_HREFS: Record<string, string> = {
  'Simple Mode': '/',
  'Manage Load Reusable Step': '/manage-steps',
  'End-to-end test': '/e2e-test',
  'API Automation': '/api-automation',
  'Check Kafka': '/kafka-checks',
  'Kafka Contract Checks': '/kafka-contract-checks',
  'Sprint Report': '/sprint-report',
};

describe('Sidebar', () => {
  it('renders all seven nav items with the correct hrefs', () => {
    renderSidebar('/');
    for (const name of ALL_LINKS) {
      expect(screen.getByRole('link', { name })).toHaveAttribute('href', LINK_HREFS[name]);
    }
  });

  for (const activeName of ALL_LINKS) {
    it(`marks ${activeName} active on ${LINK_HREFS[activeName]}, not the others`, () => {
      renderSidebar(LINK_HREFS[activeName]);
      expect(screen.getByRole('link', { name: activeName })).toHaveAttribute('aria-current', 'page');
      for (const otherName of ALL_LINKS) {
        if (otherName !== activeName) {
          expect(screen.getByRole('link', { name: otherName })).not.toHaveAttribute('aria-current');
        }
      }
    });
  }
});
