import {
  Body,
  Button,
  Column,
  Container,
  Head,
  Hr,
  Html,
  Link,
  Preview,
  Row,
  Section,
  Text,
} from "@react-email/components";

const MONO =
  "ui-monospace, Menlo, Monaco, 'Cascadia Mono', 'Segoe UI Mono', 'Roboto Mono', monospace";
const SANS =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

type Props = {
  recipientName?: string | null;
  docTitle: string;
  magicLinkUrl: string;
  actorName: string;
};

export function MagicLinkEmail({
  recipientName,
  docTitle,
  magicLinkUrl,
  actorName,
}: Props) {
  return (
    <Html>
      <Head />
      <Preview>{actorName} has issued you an edict</Preview>
      <Body
        style={{
          backgroundColor: "#06060c",
          color: "#e2e8f0",
          fontFamily: SANS,
          margin: 0,
          padding: 0,
          WebkitFontSmoothing: "antialiased",
        }}
      >
        <Container
          style={{
            maxWidth: 560,
            margin: "40px auto",
            padding: "0 24px 40px",
          }}
        >
          {/* ── Header: wordmark + subtitle ─────────────────────── */}
          <Row>
            <Column>
              {/* Wordmark: "Edict." — white word, cyan dot */}
              <Text
                style={{
                  fontFamily: MONO,
                  fontSize: 28,
                  fontWeight: 700,
                  color: "#ffffff",
                  letterSpacing: "-1px",
                  lineHeight: "1",
                  margin: "0 0 4px",
                }}
              >
                Edict
                <span style={{ color: "#00e5ff" }}>.</span>
              </Text>
            </Column>
            <Column style={{ textAlign: "right", verticalAlign: "bottom" }}>
              <Text
                style={{
                  fontFamily: MONO,
                  fontSize: 11,
                  fontWeight: 400,
                  color: "#8b8b99",
                  textTransform: "uppercase",
                  letterSpacing: "0.5px",
                  lineHeight: "1",
                  margin: 0,
                }}
              >
                A rector issues edicts
              </Text>
            </Column>
          </Row>

          {/* ── Header divider ───────────────────────────────────── */}
          <Hr
            style={{
              borderTop: "1px solid #1a1a24",
              borderRight: "none",
              borderBottom: "none",
              borderLeft: "none",
              marginTop: 24,
              marginBottom: 32,
            }}
          />

          {/* ── Body copy ───────────────────────────────────────── */}
          <Section>
            <Text
              style={{
                fontFamily: SANS,
                fontSize: 16,
                color: "#d4d4dc",
                lineHeight: "1.6",
                margin: "0 0 24px",
              }}
            >
              {recipientName ? `${recipientName}, ` : ""}
              <strong style={{ color: "#ffffff", fontWeight: 600 }}>
                {actorName}
              </strong>{" "}
              has issued you an edict:
            </Text>
          </Section>

          {/* ── Document title panel ────────────────────────────── */}
          <Section
            style={{
              backgroundColor: "#0a0a14",
              borderLeft: "3px solid #00e5ff",
              borderTop: "1px solid #1a1a24",
              borderRight: "1px solid #1a1a24",
              borderBottom: "1px solid #1a1a24",
              padding: "24px 32px",
              marginBottom: 40,
            }}
          >
            <Text
              style={{
                fontFamily: MONO,
                fontSize: 15,
                fontWeight: 500,
                color: "#ffffff",
                lineHeight: "1.5",
                margin: 0,
                wordBreak: "break-all",
              }}
            >
              {docTitle}
            </Text>
          </Section>

          {/* ── Primary CTA ─────────────────────────────────────── */}
          <Section style={{ margin: "0 0 48px" }}>
            <Button
              href={magicLinkUrl}
              style={{
                backgroundColor: "#00e5ff",
                color: "#06060c",
                fontFamily: MONO,
                fontSize: 13,
                fontWeight: 700,
                textTransform: "uppercase",
                letterSpacing: "1px",
                padding: "16px 32px",
                borderRadius: 0,
                textDecoration: "none",
                lineHeight: "1",
                display: "inline-block",
              }}
            >
              Open your edict {"\u2192"}
            </Button>
          </Section>

          {/* ── Footer separator ─────────────────────────────────── */}
          <Hr
            style={{
              borderTop: "1px solid #1a1a24",
              borderRight: "none",
              borderBottom: "none",
              borderLeft: "none",
              marginTop: 0,
              marginBottom: 0,
            }}
          />

          {/* ── Disclaimer ──────────────────────────────────────── */}
          <Section style={{ paddingTop: 24 }}>
            <Text
              style={{
                fontFamily: SANS,
                fontSize: 12,
                color: "#666677",
                lineHeight: "1.6",
                margin: "0 0 16px",
              }}
            >
              This link is valid for 24 hours. If you did not expect this,
              ignore it.
            </Text>

            {/* ── Footer wordmark ─────────────────────────────────── */}
            <Text
              style={{
                fontFamily: MONO,
                fontSize: 11,
                color: "#4a4a59",
                letterSpacing: "0.5px",
                margin: 0,
              }}
            >
              EDICT —{" "}
              <Link
                href="https://edict.rectorspace.com"
                style={{
                  color: "#666677",
                  textDecoration: "none",
                  borderBottom: "1px solid #333342",
                }}
              >
                edict.rectorspace.com
              </Link>
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}
