import React, { useState, useEffect, useMemo } from 'react';
import {
  computeSpecialistExclusions,
  detectSpecialistState,
  maskDisplayIdentifier,
  patchAuthFileExclusions,
} from '../api/managementClient';
import './SpecialistModal.css';

/**
 * SpecialistModal Component
 *
 * Configures single-model specialization (Specialist Mode 🎯) or family-wide
 * serving (Multipurpose Mode ✨) for an auth-file card.
 * Persists changes in-place using PATCH /v0/management/auth-files/fields.
 */
export default function SpecialistModal({
  isOpen,
  card,
  inheritedModels = [],
  allCatalogModels = [],
  onClose,
  onSaved,
  patchFn,
}) {
  const familyRole = (card?.familyRole || card?.family || card?.role || 'gemini').toLowerCase();
  const isGeminiFamily = familyRole === 'gemini';

  const [selectedModel, setSelectedModel] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  // Ordenar modelos según la naturaleza de la tarjeta:
  // - Para GEMINI: gemini-3.8-flash-high (o variantes 3.8) siempre en primer lugar, el resto alfabético
  // - Para CLAUDE, CODEX u otros: estrictamente orden alfabético A-Z
  const sortedInheritedModels = useMemo(() => {
    if (!Array.isArray(inheritedModels)) return [];
    return [...inheritedModels].sort((a, b) => {
      if (isGeminiFamily) {
        const aIs38 = a.includes('3.8');
        const bIs38 = b.includes('3.8');
        if (aIs38 && !bIs38) return -1;
        if (!aIs38 && bIs38) return 1;
      }
      return a.localeCompare(b);
    });
  }, [inheritedModels, isGeminiFamily]);

  // Sync state when card or modal open state changes
  useEffect(() => {
    if (!isOpen || !card) return;

    setErrorMessage('');
    setIsSaving(false);

    const specialistInfo = detectSpecialistState(card, inheritedModels);
    if (specialistInfo.isSpecialist && specialistInfo.activeSpecialistModel) {
      setSelectedModel(specialistInfo.activeSpecialistModel);
    } else {
      const defaultRecommendation = isGeminiFamily
        ? (sortedInheritedModels.find((m) => m.includes('3.8')) || sortedInheritedModels[0] || '')
        : (sortedInheritedModels[0] || '');
      setSelectedModel(defaultRecommendation);
    }
  }, [isOpen, card, inheritedModels, sortedInheritedModels, isGeminiFamily]);

  const blockedCount = useMemo(() => {
    if (!selectedModel || !Array.isArray(inheritedModels)) return 0;
    return Math.max(0, inheritedModels.length - 1);
  }, [selectedModel, inheritedModels]);

  const targetFileName = useMemo(() => {
    if (!card) return '';
    return card.virtualFileName || card.masterFileName || card.fileName || '';
  }, [card]);

  const previewExclusions = useMemo(() => {
    if (!selectedModel) return [];
    const sourcePool = Array.isArray(allCatalogModels) && allCatalogModels.length > 0
      ? allCatalogModels
      : inheritedModels;
    return computeSpecialistExclusions(sourcePool, selectedModel);
  }, [selectedModel, allCatalogModels, inheritedModels]);

  if (!isOpen || !card) {
    return null;
  }

  const handleBackdropClick = (e) => {
    if (e.target === e.currentTarget && !isSaving) {
      onClose();
    }
  };

  const handleSelectLimitSingle = (m) => {
    setSelectedModel(m);
  };

  const handleSave = async () => {
    if (!targetFileName) {
      setErrorMessage('No se encontró el archivo de credenciales para actualizar.');
      return;
    }

    setIsSaving(true);
    setErrorMessage('');

    try {
      const sourcePool = Array.isArray(allCatalogModels) && allCatalogModels.length > 0
        ? allCatalogModels
        : inheritedModels;
      const exclusionsToSave = computeSpecialistExclusions(sourcePool, selectedModel);

      const dispatchPatch = patchFn || patchAuthFileExclusions;
      await dispatchPatch(targetFileName, exclusionsToSave);

      if (typeof onSaved === 'function') {
        onSaved({
          fileName: targetFileName,
          exclusions: exclusionsToSave,
          mode: 'specialist',
          targetModel: selectedModel,
        });
      }
      onClose();
    } catch (err) {
      setErrorMessage(err.message || 'Error al guardar la configuración de modelos.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div
      className="specialist-modal-backdrop"
      onClick={handleBackdropClick}
      data-testid="specialist-modal-backdrop"
    >
      <div
        className="specialist-modal-card"
        data-testid="specialist-modal-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="specialist-modal-title"
      >
        {/* Header */}
        <div className="specialist-modal-header">
          <div className="specialist-title-row">
            <span className="specialist-title-icon">⚙️</span>
            <div>
              <h3 id="specialist-modal-title" className="specialist-title">
                Filtro de Modelos Permitidos en esta Cuenta
              </h3>
              <p className="specialist-subtitle">
                Decide qué modelo de su familia responderá esta cuenta para proteger su cuota.
              </p>
            </div>
          </div>
          <button
            type="button"
            className="specialist-close-btn"
            onClick={onClose}
            disabled={isSaving}
            aria-label="Cerrar"
          >
            ✕
          </button>
        </div>

        {/* Metadata info box */}
        <div className="specialist-metadata-box">
          <div className="specialist-meta-item">
            <span className="specialist-meta-label">Cuenta:</span>
            <span className="specialist-meta-value">
              {card.maskedEmail || maskDisplayIdentifier(targetFileName)}
            </span>
          </div>
          <div className="specialist-meta-item">
            <span className="specialist-meta-label">Archivo:</span>
            <span className="specialist-meta-value code">
              {maskDisplayIdentifier(targetFileName)}
            </span>
          </div>
          <div className="specialist-meta-item">
            <span className="specialist-meta-label">Familia:</span>
            <span className={`specialist-meta-badge ${card.familyRole || 'gemini'}`}>
              {(card.familyRole || 'gemini').toUpperCase()}
            </span>
          </div>
        </div>

        {/* Error alert if any */}
        {errorMessage && (
          <div className="specialist-error-alert" data-testid="specialist-modal-error">
            <span>⚠️</span>
            <span>{errorMessage}</span>
          </div>
        )}

        {/* Unified Selection List */}
        <div className="specialist-body" data-testid="specialist-models-container">
          <div className="specialist-list-header">
            <span className="specialist-section-label">
              Elige el modelo predeterminado para esta cuenta:
            </span>
            <span className="specialist-family-count">
              {inheritedModels.length} modelos en familia
            </span>
          </div>

          <div className="specialist-models-list">
            {sortedInheritedModels.length === 0 ? (
              <div className="specialist-empty-notice">
                No se encontraron modelos disponibles para la familia {card.familyRole || 'gemini'}.
              </div>
            ) : (
              sortedInheritedModels.map((m) => {
                const isSelected = selectedModel === m;
                const is38Gemini = isGeminiFamily && m.includes('3.8');
                return (
                  <label
                    key={m}
                    className={`specialist-model-option ${isSelected ? 'selected' : ''} ${is38Gemini ? 'model-option-top' : ''}`}
                    data-testid={`option-model-${m}`}
                  >
                    <input
                      type="radio"
                      name="model-scope-choice"
                      value={m}
                      checked={isSelected}
                      onChange={() => handleSelectLimitSingle(m)}
                      disabled={isSaving}
                    />
                    <span className="model-radio-circle" />
                    <div className="model-info-block">
                      <div className="model-title-row">
                        <span className="model-specialist-bullet">🔒</span>
                        <span className="model-radio-name mono">{m}</span>
                        {is38Gemini && (
                          <span className="model-recommended-pill">⭐ Recomendado</span>
                        )}
                      </div>
                      <span className="model-desc-hint">
                        Solo responderá a {m}. Bloquea automáticamente los otros {inheritedModels.length - 1} modelos.
                      </span>
                    </div>
                    {isSelected && <span className="model-active-pill pill-blue">Limitado</span>}
                  </label>
                );
              })
            )}
          </div>

          {/* Resumen dinámico en vivo */}
          {selectedModel && (
            <div className="specialist-preview-banner" data-testid="specialist-preview-banner">
              <span className="preview-icon">🔒</span>
              <div className="preview-text">
                <div>
                  Cuenta limitada a: <strong>{selectedModel}</strong>
                </div>
                <div className="preview-sub">
                  🚫 {blockedCount} {blockedCount === 1 ? 'modelo' : 'modelos'} de {card.familyRole || 'esta familia'} {blockedCount === 1 ? 'bloqueado' : 'bloqueados'} automáticamente para proteger la cuota.
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Actions Footer */}
        <div className="specialist-modal-footer">
          <button
            type="button"
            className="btn-modal-cancel"
            onClick={onClose}
            disabled={isSaving}
            data-testid="btn-cancel-specialist"
          >
            Cancelar
          </button>
          <button
            type="button"
            className="btn-modal-save"
            onClick={handleSave}
            disabled={isSaving || !selectedModel}
            data-testid="btn-save-specialist"
          >
            {isSaving
              ? 'Guardando...'
              : `Guardar: Limitar a ${selectedModel || 'Modelo'}`}
          </button>
        </div>
      </div>
    </div>
  );
}
