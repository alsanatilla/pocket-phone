import { Markdown } from "../../ui/Markdown.jsx";
import { hydrateCards, releaseCards } from "../../../client/pip-cards.jsx";

// A Pip answer: Markdown plus the json-render cards the renderer leaves as placeholders.
export function Prose({ text, streaming = false }) {
  return <Markdown text={text} options={{ streaming, onBeforeRender: releaseCards, onRender: element => { hydrateCards(element); } }} />;
}
