import LockRounded from '@mui/icons-material/LockRounded';
import { Box, Tooltip } from '@mui/material';
import { alpha } from '@mui/material/styles';
import { Fragment } from 'react';
import { brand } from '../theme';
import { entityLabel } from '../utils/format';

const MARKER = /^\[[A-Z][A-Z0-9_]*\]$/;
const TOKENS = /(\[[A-Z][A-Z0-9_]*\]|⟦[^⟧]*⟧)/g;
// AssemblyAI redacts word by word ("[LOCATION_ADDRESS] [LOCATION_ADDRESS], …");
// show a run of same-type markers as one redaction bar.
const MARKER_RUN = /\[([A-Z][A-Z0-9_]*)\](?:[\s,\-–]+\[\1\])+/g;
// Search snippets can cut a marker at a fragment edge ("CREDIT_CARD_NUMBER]" or
// "[CREDIT_CARD"); restore the missing bracket so it still renders as a marker.
const WORD = '(?:⟦?[A-Z0-9]+⟧?)';
const CUT_START = new RegExp(`(^|[^\\[A-Z0-9_⟦⟧])(${WORD}(?:_${WORD})+)\\]`, 'g');
const CUT_END = new RegExp(`\\[(${WORD}(?:_${WORD})*)(?=$|[^\\]A-Z0-9_⟦⟧])`, 'g');

/** A redaction marker such as [PHONE_NUMBER], rendered as a redaction bar. */
export function RedactionMarker({ entity }: { entity: string }) {
  return (
    <Tooltip title={`${entityLabel(entity)} — detected and redacted by AssemblyAI. The original value was never stored.`}>
      <Box
        component="span"
        tabIndex={0}
        aria-label={`Redacted ${entityLabel(entity)}`}
        sx={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 0.4,
          px: 0.75,
          py: '1px',
          mx: 0.25,
          borderRadius: '5px',
          bgcolor: brand.redaction,
          color: '#E2E8F0',
          fontSize: '0.72em',
          fontWeight: 650,
          letterSpacing: '0.04em',
          lineHeight: 1.6,
          verticalAlign: '0.06em',
          whiteSpace: 'nowrap',
          cursor: 'help',
        }}
      >
        <LockRounded sx={{ fontSize: '1.1em', color: brand.tealBright }} />
        {entity.replace(/_/g, ' ')}
      </Box>
    </Tooltip>
  );
}

/**
 * Renders redacted text: `[ENTITY]` markers become redaction bars and
 * ⟦…⟧ (search highlights from the API) become <mark>. Pure React elements —
 * no HTML injection.
 */
export function RedactedText({ text }: { text: string }) {
  // Search highlighting can land inside a marker ("[⟦PERSON⟧_NAME]"); move it outside.
  const normalized = text
    .replace(CUT_START, (_match, before: string, body: string) => `${before}[${body}]`)
    .replace(CUT_END, (_match, body: string) => `[${body}]`)
    .replace(/\[([A-Z0-9_⟦⟧]+)\]/g, (match, inner: string) =>
      inner.includes('⟦') ? `⟦[${inner.replace(/[⟦⟧]/g, '')}]⟧` : match,
    )
    .replace(MARKER_RUN, '[$1]');
  return (
    <>
      {normalized.split(TOKENS).map((part, index) => {
        if (MARKER.test(part)) return <RedactionMarker key={index} entity={part.slice(1, -1)} />;
        if (part.startsWith('⟦') && part.endsWith('⟧')) {
          return (
            <Box
              key={index}
              component="mark"
              sx={{ bgcolor: alpha(brand.tealBright, 0.22), color: 'inherit', borderRadius: '3px', px: '2px' }}
            >
              <RedactedText text={part.slice(1, -1)} />
            </Box>
          );
        }
        return <Fragment key={index}>{part}</Fragment>;
      })}
    </>
  );
}
