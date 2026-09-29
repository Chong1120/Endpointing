import { Box, Tooltip } from '@mui/material';
import { alpha } from '@mui/material/styles';
import { Fragment } from 'react';
import { brand, fonts } from '../theme';
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

/**
 * A redaction marker such as [PHONE_NUMBER], drawn the way redaction looks on
 * paper: a solid ink bar. The entity type is stamped faintly inside it, so the
 * bar still says what was removed.
 */
export function RedactionMarker({ entity }: { entity: string }) {
  return (
    <Tooltip title={`${entityLabel(entity)} — detected and redacted by AssemblyAI. The original value was never stored.`}>
      <Box
        component="span"
        tabIndex={0}
        aria-label={`Redacted ${entityLabel(entity)}`}
        sx={{
          display: 'inline-block',
          px: '0.7em',
          mx: '0.15em',
          borderRadius: '1px',
          bgcolor: brand.redaction,
          color: '#A89F8E',
          fontFamily: fonts.mono,
          fontSize: '0.62em',
          fontWeight: 500,
          letterSpacing: '0.1em',
          lineHeight: '1.9',
          verticalAlign: '0.12em',
          whiteSpace: 'nowrap',
          cursor: 'help',
          '&:hover, &:focus-visible': { color: brand.signal, outline: 'none' },
        }}
      >
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
              sx={{ bgcolor: alpha(brand.signal, 0.3), color: 'inherit', borderRadius: '1px', px: '2px' }}
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
