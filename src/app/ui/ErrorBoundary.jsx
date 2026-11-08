import { Component } from "react";
import { message } from "../lib/format.js";

/** Keeps a failing view (a chunk that will not load, a render that throws) inside its own box. Reset it with `key`. */
export class ErrorBoundary extends Component {
  state = { error: null };
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(error) { console.error(error); }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="notice error" role="alert">
        <p>This view failed: {message(this.state.error)}</p>
        <button className="link" onClick={() => this.setState({ error: null })}>try again</button>
      </div>
    );
  }
}
