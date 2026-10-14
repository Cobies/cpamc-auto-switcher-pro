import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import SpecialistModal from './SpecialistModal';

describe('SpecialistModal Component', () => {
  const mockCard = {
    cardId: 'antigravity-user@gmail.com.json::gemini',
    masterFileName: 'antigravity-user@gmail.com.json',
    virtualFileName: '',
    maskedEmail: 'use...ser@gmail.com',
    familyRole: 'gemini',
    assignedPrefix: 'agy',
    excludedModels: [],
    excluded_models: [],
  };

  const mockInheritedModels = [
    'gemini-2.5-pro',
    'gemini-2.5-flash',
    'gemini-2.0-flash',
  ];

  it('renders nothing when isOpen is false', () => {
    const { container } = render(
      <SpecialistModal
        isOpen={false}
        card={mockCard}
        inheritedModels={mockInheritedModels}
        onClose={vi.fn()}
      />
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders target card metadata: masked email, filename, and family role', () => {
    render(
      <SpecialistModal
        isOpen={true}
        card={mockCard}
        inheritedModels={mockInheritedModels}
        onClose={vi.fn()}
      />
    );

    expect(screen.getByTestId('specialist-modal-dialog')).toBeTruthy();
    expect(screen.getByText('use...ser@gmail.com')).toBeTruthy();
    expect(screen.getByText('GEMINI')).toBeTruthy();
    expect(screen.getByText(/Filtro de Modelos Permitidos/i)).toBeTruthy();
  });

  it('allows switching between different models in the unified list', () => {
    render(
      <SpecialistModal
        isOpen={true}
        card={mockCard}
        inheritedModels={mockInheritedModels}
        onClose={vi.fn()}
      />
    );

    // Initial default model is selected in single mode
    expect(screen.getByTestId('specialist-preview-banner')).toBeTruthy();

    // Select a specialist model
    const radioPro = screen.getByLabelText(/gemini-2.5-pro/i);
    fireEvent.click(radioPro);

    expect(screen.getByTestId('specialist-preview-banner')).toBeTruthy();
    expect(screen.getByTestId('specialist-preview-banner').textContent).toContain('gemini-2.5-pro');

    // Switch to another model
    const radioFlash = screen.getByLabelText(/gemini-2.0-flash/i);
    fireEvent.click(radioFlash);
    expect(screen.getByTestId('specialist-preview-banner').textContent).toContain('gemini-2.0-flash');
  });

  it('allows selecting strictly ONE model in specialist mode and updates exclusion counter', () => {
    render(
      <SpecialistModal
        isOpen={true}
        card={mockCard}
        inheritedModels={mockInheritedModels}
        onClose={vi.fn()}
      />
    );

    // Select gemini-2.5-pro radio directly
    const radioPro = screen.getByLabelText(/gemini-2.5-pro/i);
    fireEvent.click(radioPro);
    expect(radioPro.checked).toBe(true);

    // Live preview shows active model and 2 blocked models of gemini
    expect(screen.getByTestId('specialist-preview-banner').textContent).toContain('gemini-2.5-pro');
    expect(screen.getByTestId('specialist-preview-banner').textContent).toContain('2 modelos de gemini bloqueados');

    // Select gemini-2.0-flash
    const radioFlash2 = screen.getByLabelText(/gemini-2.0-flash/i);
    fireEvent.click(radioFlash2);
    expect(radioFlash2.checked).toBe(true);
    expect(radioPro.checked).toBe(false);

    expect(screen.getByTestId('specialist-preview-banner').textContent).toContain('gemini-2.0-flash');
  });

  it('dispatches patchAuthFileExclusions and invokes onSaved on successful save in specialist mode', async () => {
    const mockPatchFn = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    const mockOnSaved = vi.fn();
    const mockOnClose = vi.fn();

    render(
      <SpecialistModal
        isOpen={true}
        card={mockCard}
        inheritedModels={mockInheritedModels}
        onClose={mockOnClose}
        onSaved={mockOnSaved}
        patchFn={mockPatchFn}
      />
    );

    fireEvent.click(screen.getByLabelText(/gemini-2.5-pro/i));

    const saveBtn = screen.getByTestId('btn-save-specialist');
    expect(saveBtn.textContent).toContain('Limitar a gemini-2.5-pro');
    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(mockPatchFn).toHaveBeenCalledWith(
        'antigravity-user@gmail.com.json',
        ['gemini-2.0-flash', 'gemini-2.5-flash'],
        'gemini-2.5-pro'
      );
    });

    expect(mockOnSaved).toHaveBeenCalledWith(
      expect.objectContaining({
        fileName: 'antigravity-user@gmail.com.json',
        exclusions: ['gemini-2.0-flash', 'gemini-2.5-flash'],
      })
    );
    expect(mockOnClose).toHaveBeenCalled();
  });

  it('always saves exclusions isolating the selected model', async () => {
    const mockPatchFn = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    const mockOnSaved = vi.fn();
    const mockOnClose = vi.fn();

    render(
      <SpecialistModal
        isOpen={true}
        card={{ ...mockCard, excluded_models: ['gemini-2.0-flash', 'gemini-2.5-flash'] }}
        inheritedModels={mockInheritedModels}
        onClose={mockOnClose}
        onSaved={mockOnSaved}
        patchFn={mockPatchFn}
      />
    );

    const radioFlash = screen.getByLabelText(/gemini-2.0-flash/i);
    fireEvent.click(radioFlash);
    const saveBtn = screen.getByTestId('btn-save-specialist');
    expect(saveBtn.textContent).toContain('Guardar: Limitar a gemini-2.0-flash');
    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(mockPatchFn).toHaveBeenCalledWith(
        'antigravity-user@gmail.com.json',
        ['gemini-2.5-flash', 'gemini-2.5-pro'],
        'gemini-2.0-flash'
      );
    });
    expect(mockOnSaved).toHaveBeenCalled();
    expect(mockOnClose).toHaveBeenCalled();
  });

  it('opens with 3.8 selected and highlighted as recommended for gemini when card has no prior exclusions', () => {
    const models = [
      'gemini-3.1-pro-low',
      'gemini-3.8-flash-high',
      'gemini-3-flash',
    ];

    render(
      <SpecialistModal
        isOpen={true}
        card={mockCard}
        inheritedModels={models}
        onClose={vi.fn()}
      />
    );

    expect(screen.getByTestId('specialist-preview-banner')).toBeTruthy();
    expect(screen.getByTestId('specialist-preview-banner').textContent).toContain('gemini-3.8-flash-high');

    // 3.8 should still be highlighted as recommended in the single model section
    expect(screen.getByText('⭐ Recomendado')).toBeTruthy();
  });

  it('opens in single mode when card is already configured as a specialist', () => {
    const models = [
      'gemini-3.1-pro-low',
      'gemini-3.8-flash-high',
      'gemini-3-flash',
    ];
    const specialistCard = {
      ...mockCard,
      excluded_models: ['gemini-3.1-pro-low', 'gemini-3-flash'],
    };

    render(
      <SpecialistModal
        isOpen={true}
        card={specialistCard}
        inheritedModels={models}
        onClose={vi.fn()}
      />
    );

    expect(screen.getByTestId('specialist-preview-banner')).toBeTruthy();
    expect(screen.getByTestId('specialist-preview-banner').textContent).toContain('gemini-3.8-flash-high');
    const radio38 = screen.getByLabelText(/gemini-3.8-flash-high/i);
    expect(radio38.checked).toBe(true);

    const saveBtn = screen.getByTestId('btn-save-specialist');
    expect(saveBtn.textContent).toContain('Guardar: Limitar a gemini-3.8-flash-high');
  });

  it('sorts strictly alphabetically A-Z and defaults to first model for claude cards', () => {
    const claudeCard = {
      ...mockCard,
      familyRole: 'claude',
      cardId: 'antigravity-user@gmail.com.json::claude',
    };
    const claudeModels = [
      'claude-sonnet-5-5-high',
      'claude-3-7-sonnet',
      'claude-opus-4-6-thinking',
    ];

    render(
      <SpecialistModal
        isOpen={true}
        card={claudeCard}
        inheritedModels={claudeModels}
        onClose={vi.fn()}
      />
    );

    // Claude cards default to first model alphabetically
    expect(screen.getByTestId('specialist-preview-banner')).toBeTruthy();
    expect(screen.getByTestId('specialist-preview-banner').textContent).toContain('claude-3-7-sonnet');

    // Models should be strictly A-Z without recommendation badges
    expect(screen.queryByText('⭐ Recomendado')).toBeNull();
    const saveBtn = screen.getByTestId('btn-save-specialist');
    expect(saveBtn.textContent).toContain('Guardar: Limitar a claude-3-7-sonnet');
  });

  it('prioritizes Gemini 3.8 at the top of the list with recommended badge', () => {
    const modelsWith38 = [
      'gemini-3.1-pro-low',
      'gemini-3.8-flash-high',
      'gemini-3-flash',
    ];

    render(
      <SpecialistModal
        isOpen={true}
        card={mockCard}
        inheritedModels={modelsWith38}
        onClose={vi.fn()}
      />
    );

    expect(screen.getByText('⭐ Recomendado')).toBeTruthy();
    // Verify gemini-3.8-flash-high option exists and is marked recommended
    const option38 = screen.getByTestId('option-model-gemini-3.8-flash-high');
    expect(option38.textContent).toContain('gemini-3.8-flash-high');
    expect(option38.textContent).toContain('⭐ Recomendado');
  });

  it('displays error message when patchAuthFileExclusions fails without closing modal', async () => {
    const mockPatchFn = vi.fn().mockRejectedValue(new Error('Network error 500'));
    const mockOnClose = vi.fn();

    render(
      <SpecialistModal
        isOpen={true}
        card={mockCard}
        inheritedModels={mockInheritedModels}
        onClose={mockOnClose}
        patchFn={mockPatchFn}
      />
    );

    fireEvent.click(screen.getByLabelText(/gemini-2.5-pro/i));
    fireEvent.click(screen.getByTestId('btn-save-specialist'));

    await waitFor(() => {
      expect(screen.getByTestId('specialist-modal-error').textContent).toContain('Network error 500');
    });

    expect(mockOnClose).not.toHaveBeenCalled();
  });

  it('closes without saving when Cancel or Close button is clicked', () => {
    const mockOnClose = vi.fn();
    const mockPatchFn = vi.fn();

    render(
      <SpecialistModal
        isOpen={true}
        card={mockCard}
        inheritedModels={mockInheritedModels}
        onClose={mockOnClose}
        patchFn={mockPatchFn}
      />
    );

    fireEvent.click(screen.getByTestId('btn-cancel-specialist'));
    expect(mockOnClose).toHaveBeenCalledTimes(1);
    expect(mockPatchFn).not.toHaveBeenCalled();
  });

  it('closes when backdrop is clicked', () => {
    const mockOnClose = vi.fn();

    render(
      <SpecialistModal
        isOpen={true}
        card={mockCard}
        inheritedModels={mockInheritedModels}
        onClose={mockOnClose}
      />
    );

    fireEvent.click(screen.getByTestId('specialist-modal-backdrop'));
    expect(mockOnClose).toHaveBeenCalledTimes(1);
  });
});
