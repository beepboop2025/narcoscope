// A soft "plain English" callout that translates the chart/map above it into
// one human sentence. Renders nothing if there's no sentence to show.
export default function Explainer({ text }) {
  if (!text) return null
  return (
    <p className="explainer">
      <span className="explainer-tag">In plain English</span>
      {text}
    </p>
  )
}
