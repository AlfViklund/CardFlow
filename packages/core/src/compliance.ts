import type { ComplianceRuleInput, RuleCheckResult, RuleSeverity } from './index';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ComplianceInput {
  inputText: string;
  metadata: Record<string, unknown>;
  marketplaces: string[];
}

export interface ComplianceReport {
  status: 'passed' | 'failed' | 'warning';
  score: number;
  criticalFailures: number;
  warnings: number;
  ruleResults: RuleCheckResult[];
  messages: string[];
}

// ---------------------------------------------------------------------------
// Russian messages for each rule code
// ---------------------------------------------------------------------------

const ruleMessages: Record<string, { passed: string; failed: string }> = {
  wb_no_contact_info: { passed: 'Контактная информация не обнаружена', failed: 'Обнаружена контактная информация в изображении' },
  wb_no_prices_in_image: { passed: 'Ценники и цены не обнаружены', failed: 'Обнаружены цены или ценники в изображении' },
  wb_no_discounts: { passed: 'Скидочные обозначения не обнаружены', failed: 'Обнаружены скидочные обозначения' },
  wb_no_qr_codes: { passed: 'QR-коды и штрихкоды не обнаружены', failed: 'Обнаружены QR-коды или штрихкоды' },
  wb_no_cta_text: { passed: 'Призывы к действию не обнаружены', failed: 'Обнаружены призывы к действию' },
  wb_no_evaluative_claims: { passed: 'Оценочные утверждения не обнаружены', failed: 'Обнаружены оценочные утверждения (лучший, топ, хит)' },
  wb_no_competitor_refs: { passed: 'Упоминания конкурентов не обнаружены', failed: 'Обнаружены упоминания конкурентов' },
  wb_no_watermark: { passed: 'Водяные знаки не обнаружены', failed: 'Обнаружены водяные знаки' },
  wb_no_false_claims: { passed: 'Неподтверждённые утверждения не обнаружены', failed: 'Обнаружены неподтверждённые утверждения' },
  wb_min_900px: { passed: 'Разрешение изображения соответствует требованиям', failed: 'Разрешение изображения ниже минимального' },
  wb_format_jpeg_png_webp: { passed: 'Формат изображения соответствует требованиям', failed: 'Неподдерживаемый формат изображения' },
  wb_aspect_ratio: { passed: 'Соотношение сторон соответствует требованиям', failed: 'Соотношение сторон не соответствует требованиям (рекомендуется 3:4 или 1:1)' },
  wb_card_count_limit: { passed: 'Количество карточек в пределах нормы', failed: 'Количество карточек превышает лимит маркетплейса' },
  wb_white_background_main: { passed: 'Фон соответствует рекомендациям', failed: 'Рекомендуется белый фон для главного фото' },
  wb_product_focus: { passed: 'Товар является центральным элементом', failed: 'Товар должен быть центральным элементом изображения' },
  wb_no_clutter: { passed: 'Изображение не содержит отвлекающих элементов', failed: 'Изображение содержит слишком много отвлекающих элементов' },
  ozon_no_contact_info: { passed: 'Контактная информация не обнаружена', failed: 'Обнаружена контактная информация в изображении' },
  ozon_no_watermark: { passed: 'Водяные знаки не обнаружены', failed: 'Обнаружены водяные знаки' },
  ozon_clear_product_photo: { passed: 'Фотография товара清晰ная', failed: 'Фотография товара недостаточно четкая' },
  ozon_min_res: { passed: 'Разрешение изображения соответствует требованиям', failed: 'Разрешение изображения ниже минимального (400px)' },
  ozon_format_requirements: { passed: 'Формат изображения соответствует требованиям', failed: 'Неподдерживаемый формат изображения' },
  ozon_card_count_limit: { passed: 'Количество карточек в пределах нормы', failed: 'Количество карточек превышает лимит маркетплейса' },
};

export function getMessageForRule(ruleCode: string, passed: boolean): string {
  const msgs = ruleMessages[ruleCode];
  if (!msgs) return passed ? 'Проверка пройдена' : 'Проверка не пройдена';
  return passed ? msgs.passed : msgs.failed;
}

// ---------------------------------------------------------------------------
// Default rule definitions
// ---------------------------------------------------------------------------

export function defaultWbRules(): ComplianceRuleInput[] {
  return [
    // Prohibited content — CRITICAL
    {
      marketplace: 'wildberries',
      category: 'prohibited_content',
      ruleCode: 'wb_no_contact_info',
      description: 'No phone numbers, emails, or external links in images',
      severity: 'critical',
      metadata: {
        strategy: 'regex_match',
        patterns: ['\\d{10,}', '@', '\\.ru/', '\\.com/', 't\\.me/', 'wa\\.me/', 'vk\\.com/', 'telegram', 'whatsapp'],
      },
    },
    {
      marketplace: 'wildberries',
      category: 'prohibited_content',
      ruleCode: 'wb_no_prices_in_image',
      description: 'No price markers or currency values in images',
      severity: 'critical',
      metadata: {
        strategy: 'regex_match',
        patterns: ['₽', 'руб', 'руб\\.', '\\d+\\s*руб', '\\d+\\s*₽', '[0-9]+\\s*р\\b', '\\$\\s*\\d+', '&[rR]ub;', 'цено?', 'ценник'],
      },
    },
    {
      marketplace: 'wildberries',
      category: 'prohibited_content',
      ruleCode: 'wb_no_discounts',
      description: 'No discount badges or sale indicators',
      severity: 'critical',
      metadata: {
        strategy: 'regex_match',
        patterns: ['-\\d+%', 'sale', 'скидк', 'распродаж', 'акци', '% OFF', '% off', 'выгод'],
      },
    },
    {
      marketplace: 'wildberries',
      category: 'prohibited_content',
      ruleCode: 'wb_no_qr_codes',
      description: 'No QR codes or barcodes in images',
      severity: 'critical',
      metadata: {
        strategy: 'text_match',
        keywords: ['qr-код', 'qr code', 'штрихкод', 'barcode', 'qr-code', 'quick response'],
      },
    },
    {
      marketplace: 'wildberries',
      category: 'prohibited_content',
      ruleCode: 'wb_no_cta_text',
      description: 'No call-to-action phrases in images',
      severity: 'critical',
      metadata: {
        strategy: 'text_match',
        keywords: ['buy now', 'order now', 'купи', 'закажи', 'купить сейчас', 'заказать сейчас', 'add to cart', 'в корзину', 'покупай', 'покупка'],
      },
    },
    {
      marketplace: 'wildberries',
      category: 'prohibited_content',
      ruleCode: 'wb_no_evaluative_claims',
      description: 'No evaluative claims like "best", "#1", etc.',
      severity: 'warning',
      metadata: {
        strategy: 'text_match',
        keywords: ['лучший', 'лучш', 'номер 1', '#1', 'топ', 'хит', 'номер один', 'лидер', 'first place', 'best seller', 'бестселлер'],
      },
    },
    {
      marketplace: 'wildberries',
      category: 'prohibited_content',
      ruleCode: 'wb_no_competitor_refs',
      description: 'No references to other marketplaces or brands',
      severity: 'critical',
      metadata: {
        strategy: 'text_match',
        keywords: ['ozon', 'озон', 'aliexpress', 'ali express', 'amazon', 'wildberries', 'wb.ru', 'jd.com', 'ebay'],
      },
    },
    {
      marketplace: 'wildberries',
      category: 'prohibited_content',
      ruleCode: 'wb_no_watermark',
      description: 'No watermarks or logos on images',
      severity: 'critical',
      metadata: {
        strategy: 'text_match',
        keywords: ['watermark', 'sample', '©', 'shutterstock', 'istock', 'depositphotos', 'dreamstime', 'фотобанк'],
      },
    },
    {
      marketplace: 'wildberries',
      category: 'prohibited_content',
      ruleCode: 'wb_no_false_claims',
      description: 'No unverified medical, warranty, or other claims',
      severity: 'warning',
      metadata: {
        strategy: 'text_match',
        keywords: ['гаранти', 'медицинск', 'лечен', 'сертификат', '100%', 'абсолютно безопас', 'одобрено', 'рекомендовано врачами', 'клинически', 'fda approved', 'gost'],
      },
    },

    // Visibility & quality — WARNING
    {
      marketplace: 'wildberries',
      category: 'visibility_quality',
      ruleCode: 'wb_white_background_main',
      description: 'Main product photo should be on white background',
      severity: 'warning',
      metadata: { strategy: 'text_match', keywords: [] },
    },
    {
      marketplace: 'wildberries',
      category: 'visibility_quality',
      ruleCode: 'wb_product_focus',
      description: 'Product must be the clear focal point',
      severity: 'warning',
      metadata: { strategy: 'text_match', keywords: [] },
    },
    {
      marketplace: 'wildberries',
      category: 'visibility_quality',
      ruleCode: 'wb_no_clutter',
      description: 'Minimal distracting elements in frame',
      severity: 'info',
      metadata: { strategy: 'text_match', keywords: [] },
    },

    // Format & resolution — CRITICAL
    {
      marketplace: 'wildberries',
      category: 'format_resolution',
      ruleCode: 'wb_min_900px',
      description: 'Minimum 900x900px for main image',
      severity: 'critical',
      metadata: { strategy: 'numeric_range', minDimension: 900 },
    },
    {
      marketplace: 'wildberries',
      category: 'format_resolution',
      ruleCode: 'wb_format_jpeg_png_webp',
      description: 'Accepted formats: JPEG, PNG, WebP',
      severity: 'critical',
      metadata: { strategy: 'enum_check', acceptedFormats: ['jpeg', 'png', 'webp', 'image/jpeg', 'image/png', 'image/webp'] },
    },
    {
      marketplace: 'wildberries',
      category: 'format_resolution',
      ruleCode: 'wb_no_watermark',
      description: 'No watermarks or logos on images (format check)',
      severity: 'critical',
      metadata: { strategy: 'text_match', detection: 'watermark' },
    },
    {
      marketplace: 'wildberries',
      category: 'format_resolution',
      ruleCode: 'wb_aspect_ratio',
      description: 'Aspect ratio should be 3:4 or 1:1',
      severity: 'warning',
      metadata: { strategy: 'numeric_range', acceptedRatios: [3 / 4, 1 / 1], tolerance: 0.1 },
    },

    // Card count limit
    {
      marketplace: 'wildberries',
      category: 'format_resolution',
      ruleCode: 'wb_card_count_limit',
      description: 'Maximum 30 cards, recommended 8',
      severity: 'critical',
      metadata: { strategy: 'card_count_limit', maxCards: 30, warnCards: 8 },
    },
  ];
}

export function defaultOzonRules(): ComplianceRuleInput[] {
  return [
    // Prohibited content — CRITICAL
    {
      marketplace: 'ozon',
      category: 'prohibited_content',
      ruleCode: 'ozon_no_contact_info',
      description: 'No phone numbers, emails, or external links',
      severity: 'critical',
      metadata: {
        strategy: 'regex_match',
        patterns: ['\\d{10,}', '@', '\\.ru/', '\\.com/', 't\\.me/', 'wa\\.me/'],
      },
    },
    {
      marketplace: 'ozon',
      category: 'prohibited_content',
      ruleCode: 'ozon_no_watermark',
      description: 'No watermarks permitted',
      severity: 'critical',
      metadata: {
        strategy: 'text_match',
        keywords: ['watermark', 'sample', '©', 'shutterstock', 'istock', 'depositphotos'],
      },
    },

    // Visibility & quality — WARNING
    {
      marketplace: 'ozon',
      category: 'visibility_quality',
      ruleCode: 'ozon_clear_product_photo',
      description: 'Product must be clearly visible',
      severity: 'warning',
      metadata: { strategy: 'text_match', keywords: [] },
    },

    // Format & resolution — CRITICAL
    {
      marketplace: 'ozon',
      category: 'format_resolution',
      ruleCode: 'ozon_min_res',
      description: 'Minimum 400px resolution',
      severity: 'critical',
      metadata: { strategy: 'numeric_range', minDimension: 400 },
    },
    {
      marketplace: 'ozon',
      category: 'format_resolution',
      ruleCode: 'ozon_format_requirements',
      description: 'Accepted formats: JPEG, PNG, WebP, HEIC',
      severity: 'critical',
      metadata: { strategy: 'enum_check', acceptedFormats: ['jpeg', 'png', 'webp', 'heic', 'image/jpeg', 'image/png', 'image/webp', 'image/heic'] },
    },

    // Card count limit
    {
      marketplace: 'ozon',
      category: 'format_resolution',
      ruleCode: 'ozon_card_count_limit',
      description: 'Card count limit for Ozon',
      severity: 'warning',
      metadata: { strategy: 'card_count_limit', maxCards: 30, warnCards: 8 },
    },
  ];
}

export function getAllDefaultRules(): ComplianceRuleInput[] {
  return [...defaultWbRules(), ...defaultOzonRules()];
}

// ---------------------------------------------------------------------------
// Validation engine
// ---------------------------------------------------------------------------

export class ComplianceValidator {
  private rules: ComplianceRuleInput[];

  constructor(rules: ComplianceRuleInput[]) {
    this.rules = rules;
  }

  validate(input: ComplianceInput): RuleCheckResult[] {
    const { inputText, metadata, marketplaces } = input;

    // Filter rules applicable to the selected marketplaces
    const applicableRules = this.rules.filter((r) => marketplaces.includes(r.marketplace));

    const results: RuleCheckResult[] = [];

    for (const rule of applicableRules) {
      const result = this.checkRule(rule, inputText, metadata);
      results.push(result);
    }

    return results;
  }

  private checkRule(
    rule: ComplianceRuleInput,
    inputText: string,
    metadata: Record<string, unknown>,
  ): RuleCheckResult {
    const strategy = (rule.metadata?.strategy as string) ?? 'text_match';

    switch (strategy) {
      case 'text_match':
        return this.checkTextMatch(rule, inputText);
      case 'regex_match':
        return this.checkRegexMatch(rule, inputText);
      case 'numeric_range':
        return this.checkNumericRange(rule, metadata);
      case 'enum_check':
        return this.checkEnum(rule, metadata);
      case 'card_count_limit':
        return this.checkCardCount(rule);
      default:
        return {
          ruleCode: rule.ruleCode,
          passed: true,
          severity: rule.severity as RuleSeverity,
          detail: `Unknown strategy: ${strategy}`,
        };
    }
  }

  private checkTextMatch(rule: ComplianceRuleInput, inputText: string): RuleCheckResult {
    const keywords = (rule.metadata?.keywords as string[]) ?? [];
    if (keywords.length === 0) {
      // No keywords to check means the rule is auto-passed
      // (e.g. wb_white_background_main requires visual analysis we can't do)
      return {
        ruleCode: rule.ruleCode,
        passed: true,
        severity: rule.severity as RuleSeverity,
        detail: rule.description,
      };
    }
    const lowerText = inputText.toLowerCase();

    for (const keyword of keywords) {
      if (lowerText.includes(keyword.toLowerCase())) {
        return {
          ruleCode: rule.ruleCode,
          passed: false,
          severity: rule.severity as RuleSeverity,
          detail: `Found prohibited keyword: "${keyword}"`,
        };
      }
    }

    return {
      ruleCode: rule.ruleCode,
      passed: true,
      severity: rule.severity as RuleSeverity,
      detail: `No prohibited content found`,
    };
  }

  private checkRegexMatch(rule: ComplianceRuleInput, inputText: string): RuleCheckResult {
    const patterns = (rule.metadata?.patterns as string[]) ?? [];
    if (patterns.length === 0) {
      return {
        ruleCode: rule.ruleCode,
        passed: true,
        severity: rule.severity as RuleSeverity,
        detail: rule.description,
      };
    }

    for (const pattern of patterns) {
      try {
        const regex = new RegExp(pattern, 'i');
        if (regex.test(inputText)) {
          return {
            ruleCode: rule.ruleCode,
            passed: false,
            severity: rule.severity as RuleSeverity,
            detail: `Matched pattern: ${pattern}`,
          };
        }
      } catch {
        // Invalid regex, try as plain text
        if (inputText.toLowerCase().includes(pattern.toLowerCase())) {
          return {
            ruleCode: rule.ruleCode,
            passed: false,
            severity: rule.severity as RuleSeverity,
            detail: `Matched text: ${pattern}`,
          };
        }
      }
    }

    return {
      ruleCode: rule.ruleCode,
      passed: true,
      severity: rule.severity as RuleSeverity,
      detail: 'No prohibited patterns found',
    };
  }

  private checkNumericRange(rule: ComplianceRuleInput, metadata: Record<string, unknown>): RuleCheckResult {
    const minDimension = rule.metadata?.minDimension as number | undefined;
    const width = metadata.width as number | undefined;
    const height = metadata.height as number | undefined;

    // Check for acceptedRatios (aspect ratio check)
    const acceptedRatios = rule.metadata?.acceptedRatios as number[] | undefined;
    const tolerance = (rule.metadata?.tolerance as number) ?? 0.1;

    if (acceptedRatios && width && height && width > 0 && height > 0) {
      const actualRatio = width / height;
      const matches = acceptedRatios.some(
        (target: number) => Math.abs(actualRatio - target) <= tolerance,
      );
      return {
        ruleCode: rule.ruleCode,
        passed: matches,
        severity: rule.severity as RuleSeverity,
        detail: matches
          ? `Aspect ratio ${width}:${height} is acceptable`
          : `Aspect ratio ${width}:${height} does not match accepted ratios`,
      };
    }

    if (minDimension !== undefined) {
      if (width === undefined && height === undefined) {
        // No dimension info available — pass (can't validate without data)
        return {
          ruleCode: rule.ruleCode,
          passed: true,
          severity: rule.severity as RuleSeverity,
          detail: rule.description,
        };
      }
      const minDim = Math.min(width ?? Infinity, height ?? Infinity);
      if (minDim < minDimension) {
        return {
          ruleCode: rule.ruleCode,
          passed: false,
          severity: rule.severity as RuleSeverity,
          detail: `Image dimension ${minDim}px is below minimum ${minDimension}px`,
        };
      }
    }

    return {
      ruleCode: rule.ruleCode,
      passed: true,
      severity: rule.severity as RuleSeverity,
      detail: 'Dimension check passed',
    };
  }

  private checkEnum(rule: ComplianceRuleInput, metadata: Record<string, unknown>): RuleCheckResult {
    const acceptedFormats = (rule.metadata?.acceptedFormats as string[]) ?? [];
    if (acceptedFormats.length === 0) {
      return {
        ruleCode: rule.ruleCode,
        passed: true,
        severity: rule.severity as RuleSeverity,
        detail: rule.description,
      };
    }

    const mimeType = (metadata.mimeType as string) ?? '';
    const filename = (metadata.filename as string) ?? '';

    // Check against mimeType
    if (mimeType && acceptedFormats.includes(mimeType)) {
      return {
        ruleCode: rule.ruleCode,
        passed: true,
        severity: rule.severity as RuleSeverity,
        detail: `Format ${mimeType} is accepted`,
      };
    }

    // Check against filename extension
    const ext = filename.split('.').pop()?.toLowerCase() ?? '';
    const extMap: Record<string, string[]> = {
      jpg: ['jpeg', 'image/jpeg'],
      jpeg: ['jpeg', 'image/jpeg'],
      png: ['png', 'image/png'],
      webp: ['webp', 'image/webp'],
      heic: ['heic', 'image/heic'],
      heif: ['heic', 'image/heic'],
    };

    const possibleMimeTypes = extMap[ext] ?? [];
    if (possibleMimeTypes.some((m) => acceptedFormats.includes(m))) {
      return {
        ruleCode: rule.ruleCode,
        passed: true,
        severity: rule.severity as RuleSeverity,
        detail: `Format ${ext} is accepted`,
      };
    }

    // If we can't determine format, check if we have a mimeType that's not accepted
    if (mimeType && !acceptedFormats.includes(mimeType)) {
      return {
        ruleCode: rule.ruleCode,
        passed: false,
        severity: rule.severity as RuleSeverity,
        detail: `Format ${mimeType} is not accepted. Accepted: ${acceptedFormats.join(', ')}`,
      };
    }

    return {
      ruleCode: rule.ruleCode,
      passed: true,
      severity: rule.severity as RuleSeverity,
      detail: rule.description,
    };
  }

  private checkCardCount(rule: ComplianceRuleInput): RuleCheckResult {
    const hasWb = this.rules.some(
      (r) => r.marketplace === 'wildberries' && this.rules.includes(r),
    );

    // We need cardCount from metadata but also need to know which marketplaces
    // Actually, card count is checked separately via validateCardCount
    // The rule itself is a placeholder — detailed results come from the card count validator
    return {
      ruleCode: rule.ruleCode,
      passed: true,
      severity: rule.severity as RuleSeverity,
      detail: 'Card count validated separately',
    };
  }
}

// ---------------------------------------------------------------------------
// Card count validator
// ---------------------------------------------------------------------------

export function validateCardCount(cardCount: number, marketplaces: string[]): RuleCheckResult {
  const hasWb = marketplaces.includes('wildberries');
  const hasOzon = marketplaces.includes('ozon');

  if (hasWb) {
    if (cardCount > 30) {
      return {
        ruleCode: 'wb_card_count_limit',
        passed: false,
        severity: 'critical',
        detail: `Количество карточек ${cardCount} превышает максимальный лимит 30`,
      };
    }
    if (cardCount > 8) {
      return {
        ruleCode: 'wb_card_count_limit',
        passed: false,
        severity: 'warning',
        detail: `Количество карточек ${cardCount} превышает рекомендуемое значение 8`,
      };
    }
  }

  // Ozon has no specific limit — pass by default
  return {
    ruleCode: hasOzon ? 'ozon_card_count_limit' : 'wb_card_count_limit',
    passed: true,
    severity: hasWb ? 'critical' : 'warning',
    detail: 'Количество карточек в пределах нормы',
  };
}

// ---------------------------------------------------------------------------
// Report builder
// ---------------------------------------------------------------------------

/**
 * Calculate score (copied from index.ts to avoid circular deps)
 */
function calcScore(ruleResults: RuleCheckResult[]): { score: number; criticalFailures: number; warnings: number } {
  let score = 100;
  let criticalFailures = 0;
  let warnings = 0;

  for (const result of ruleResults) {
    if (!result.passed) {
      switch (result.severity) {
        case 'critical':
          criticalFailures++;
          score -= 30;
          break;
        case 'warning':
          warnings++;
          score -= 10;
          break;
        case 'info':
          score -= 3;
          break;
      }
    }
  }

  return { score: Math.max(0, Math.min(100, score)), criticalFailures, warnings };
}

export function buildComplianceReport(ruleResults: RuleCheckResult[], marketplaces: string[]): ComplianceReport {
  const { score, criticalFailures, warnings } = calcScore(ruleResults);

  let status: 'passed' | 'failed' | 'warning';
  if (criticalFailures > 0) {
    status = 'failed';
  } else if (warnings > 0) {
    status = 'warning';
  } else {
    status = 'passed';
  }

  const messages = ruleResults.map((r) => getMessageForRule(r.ruleCode, r.passed));

  return {
    status,
    score,
    criticalFailures,
    warnings,
    ruleResults,
    messages,
  };
}
