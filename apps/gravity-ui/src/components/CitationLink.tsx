"use client";

interface Props {
  id: number;
  onClick?: (id: number) => void;
}

export function CitationLink({ id, onClick }: Props) {
  return (
    <button
      onClick={() => onClick?.(id)}
      className="inline-flex items-center justify-center w-5 h-5 rounded text-[10px] font-bold bg-gravity-600/30 text-gravity-300 border border-gravity-500/40 hover:bg-gravity-600/50 hover:text-gravity-200 transition-all align-super ml-0.5 cursor-pointer"
      title={`Jump to source ${id}`}
    >
      {id}
    </button>
  );
}

/**
 * Parses answer text and replaces [Source N] with <CitationLink> components.
 */
export function parseAnswerWithCitations(
  text: string,
  onCitationClick?: (id: number) => void
): React.ReactNode[] {
  const parts = text.split(/(\[Source \d+\])/g);
  return parts.map((part, i) => {
    const match = part.match(/\[Source (\d+)\]/);
    if (match) {
      return <CitationLink key={i} id={parseInt(match[1])} onClick={onCitationClick} />;
    }
    return part;
  });
}
