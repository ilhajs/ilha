import Counter from "./_counter" with { island: "load" };

export default function About() {
  return (
    <section>
      <h1>About</h1>
      <p>
        This page is an island page: Void sends static HTML, and only the
        counter below ships JavaScript.
      </p>
      <Counter start={1} />
    </section>
  );
}
