import type { Card } from "./summary";
import { countriesCard, disastersCard, ownersCard, type SummaryInput } from "./summary";

export type CardKind = "countries" | "owners" | "disasters";

function Badge({ level }: { level: string | null }) {
  if (!level) return null;
  const cls = level === "High" ? "badge high" : level === "Watch" ? "badge watch" : "badge alert";
  return <span className={cls}>{level}</span>;
}

function AnswerCard({ title, card, pressed, onClick }: { title: string; card: Card; pressed: boolean; onClick: () => void }) {
  return (
    <button type="button" className="card" aria-pressed={pressed} onClick={onClick}>
      <span className="card-title">{title}</span>
      <span className="card-headline">{card.headline}</span>
      {card.items.length > 0 && (
        <ul className="card-items">
          {card.items.map((i) => (
            <li key={i.key}><span className="item-label">{i.label}</span> <span className="num">{i.value}</span> <Badge level={i.level} /></li>
          ))}
        </ul>
      )}
      {card.more && <span className="card-more">{card.more}</span>}
      <span className="card-note">{card.note}</span>
    </button>
  );
}

/** The three answers a first-time user looks for. A click highlights the matches on the map. */
export default function AnswerCards(props: {
  view: SummaryInput; high: number; watch: number; active: CardKind | null; onOpen: (k: CardKind) => void;
}) {
  const { view, high, watch, active, onOpen } = props;
  return (
    <section className="cards" aria-label="Answers">
      <AnswerCard title="Countries" card={countriesCard(view, high, watch)} pressed={active === "countries"} onClick={() => onOpen("countries")} />
      <AnswerCard title="Owner companies" card={ownersCard(view, watch)} pressed={active === "owners"} onClick={() => onOpen("owners")} />
      <AnswerCard title="Disasters now" card={disastersCard(view)} pressed={active === "disasters"} onClick={() => onOpen("disasters")} />
    </section>
  );
}
