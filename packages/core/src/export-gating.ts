/**
 * Marketplace compliance gating for export pipeline (task 2ecad978).
 *
 * Combines compliance validation (prohibited content detection) and quality
 * scoring into a single gating layer that blocks ZIP export when critical
 * failures are found. Generates structured validation reports with per-card
 * pass/fail status.
 */

import {
  ComplianceValidator,
  buildComplianceReport,
  getAllDefaultRules,
  type ComplianceInput,
} from './compliance';
import type { RuleCheckResult, ComplianceReport } from './index';
import {
  analyzeQuality,
  makeGatingDecision,
  type QualityAnalysisInput,
} from './quality';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CardValidationInput {
  cardNumber: number;
  inputText: string;        // brief + any embedded text for content scanning
  metadata: {              // image metadata for quality checks
    width?: number;
    height?: number;
    fileSizeBytes?: number;
    mimeType?: string;
    brightness?: number;
  };
  marketplaces: string[];
}

export interface CardValidationResult {
  cardNumber: number;
  compliance: ComplianceReport;
  quality: {
    score: number;
    risks: Array<{ code: string; severity: string; detail: string }>;
    gatingDecision: string;
  };
  overallStatus: 'pass' | 'warning' | 'blocked';
  violations: Array<{
    cardNumber: number;
    ruleCode: string;
    severity: 'critical' | 'warning';
    detail: string;
  }>;
}

export interface ExportValidationResult {
  projectId: string;
  totalCards: number;
  validatedCards: number;
  blockedCards: number;
  warningCards: number;
  passCards: number;
  cardDetails: CardValidationResult[];
  exportAllowed: boolean;
  blockingReasons: string[];
  validatedAt: string;
}

// ---------------------------------------------------------------------------
// Export gating engine
// ---------------------------------------------------------------------------

/**
 * Validate a single card against compliance + quality rules.
 */
export function validateExportCard(input: CardValidationInput): CardValidationResult {
  const { cardNumber, inputText, metadata, marketplaces } = input;

  // Compliance check
  const rules = getAllDefaultRules().filter((r) => marketplaces.includes(r.marketplace));
  const validator = new ComplianceValidator(rules);
  const complianceInput: ComplianceInput = {
    inputText,
    metadata,
    marketplaces,
  };
  const ruleResults = validator.validate(complianceInput);
  const compliance = buildComplianceReport(ruleResults, marketplaces);

  // Quality check
  const qualityInput: QualityAnalysisInput = {
    width: metadata.width ?? 0,
    height: metadata.height ?? 0,
    fileSizeBytes: metadata.fileSizeBytes ?? 0,
    mimeType: metadata.mimeType ?? '',
    brightness: metadata.brightness,
  };
  const quality = analyzeQuality(qualityInput, marketplaces);

  // Determine overall status
  const hasCritical = compliance.criticalFailures > 0;
  const hasWarning = compliance.warnings > 0 || quality.risks.some((r: { severity: string }) => r.severity === 'warning');
  const isBlocked = hasCritical || quality.gatingDecision === 'blocked';

  let overallStatus: 'pass' | 'warning' | 'blocked';
  if (isBlocked) {
    overallStatus = 'blocked';
  } else if (hasWarning) {
    overallStatus = 'warning';
  } else {
    overallStatus = 'pass';
  }

  // Collect violations
  const violations: CardValidationResult['violations'] = [];

  for (const r of compliance.ruleResults) {
    if (!r.passed) {
      violations.push({
        cardNumber,
        ruleCode: r.ruleCode,
        severity: r.severity as 'critical' | 'warning',
        detail: r.detail,
      });
    }
  }

  for (const risk of quality.risks) {
    violations.push({
      cardNumber,
      ruleCode: risk.code,
      severity: risk.severity as 'critical' | 'warning',
      detail: risk.detail,
    });
  }

  return {
    cardNumber,
    compliance,
    quality: {
      score: quality.overallScore,
      risks: quality.risks,
      gatingDecision: quality.gatingDecision,
    },
    overallStatus,
    violations,
  };
}

/**
 * Validate all cards in a project before allowing export.
 */
export function validateProjectForExport(
  projectId: string,
  cards: CardValidationInput[],
): ExportValidationResult {
  const cardDetails = cards.map((card) => validateExportCard(card));

  const totalCards = cardDetails.length;
  const blockedCards = cardDetails.filter((c) => c.overallStatus === 'blocked').length;
  const warningCards = cardDetails.filter((c) => c.overallStatus === 'warning').length;
  const passCards = cardDetails.filter((c) => c.overallStatus === 'pass').length;

  // Collect blocking reasons
  const blockingReasons: string[] = [];
  for (const card of cardDetails.filter((c) => c.overallStatus === 'blocked')) {
    for (const v of card.violations.filter((vi) => vi.severity === 'critical')) {
      blockingReasons.push(`Card ${card.cardNumber}: ${v.detail}`);
    }
  }

  // Deduplicate blocking reasons
  const uniqueBlockingReasons = [...new Set(blockingReasons)];

  // Export allowed only when no cards are blocked
  const exportAllowed = blockedCards === 0;

  return {
    projectId,
    totalCards,
    validatedCards: totalCards,
    blockedCards,
    warningCards,
    passCards,
    cardDetails,
    exportAllowed,
    blockingReasons: uniqueBlockingReasons,
    validatedAt: new Date().toISOString(),
  };
}
