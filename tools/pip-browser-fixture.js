// Run with T3 preview_evaluate on the background localhost:8881 preview only.
// All chat requests are fake; no provider key or account is used.
(async () => {
  if (location.origin !== "http://localhost:8881") throw new Error("Use the isolated preview origin.");
  const drive = await import("/js/drive.js?v=20261006-072");
  if (drive.connected()) throw new Error("Disconnect this preview before using fixtures.");
  globalThis.pipFixture = { requests: [], mode: "answer", fetch: globalThis.fetch };
  globalThis.fetch = async (url, options) => {
    if (!String(url).startsWith("https://api.anthropic.com/v1/messages")) return pipFixture.fetch(url, options);
    pipFixture.requests.push(JSON.parse(options.body));
    const frame = event => "data: " + JSON.stringify(event) + "\n\n";
    const frames = [
      { type:"message_start", message:{model:"fixture-model",usage:{input_tokens:120}} },
      { type:"content_block_delta", delta:{type:"thinking_delta",thinking:"The attached note suggests choosing the train before planning the rest of the weekend."} },
      { type:"content_block_delta", delta:{type:"text_delta",text:"## A weekend in Hamburg\n\nKeep the research in your note. When you decide to go, choose one action:\n\n**Book the train to Hamburg.**\n\n- Compare departure times.\n- Choose a return on Sunday.\n\nYour idea can stay undecided until you choose a task."} },
      { type:"message_delta", delta:{stop_reason:"end_turn"}, usage:{output_tokens:74} },
      { type:"message_stop" }
    ];
    let timer, cursor=0;
    return new Response(new ReadableStream({
      start(controller) { timer=setInterval(()=>{ if (pipFixture.mode === "hold" && cursor>=2) return; if (options.signal.aborted) { clearInterval(timer);controller.close();return; } controller.enqueue(new TextEncoder().encode(frame(frames[cursor++])));if(cursor===frames.length){clearInterval(timer);controller.close();} },180); },
      cancel() { clearInterval(timer); }
    }), { headers:{"content-type":"text/event-stream"} });
  };
  return {fixture:true,driveConnected:false};
})()
