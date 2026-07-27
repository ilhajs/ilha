export const example = `import ilha from "ilha";

export default ilha
  .css\`
    .card {
      border-radius: 0.5rem;
      border: 1px solid #86efac;
      background: #ecfdf5;
      padding: 1rem;
    }
    .card__title {
      font-weight: 700;
      color: #166534;
      margin: 0 0 0.75rem;
    }
    .card__button {
      background: #0d9488;
      color: white;
      border-radius: 0.375rem;
      border: none;
      padding: 0.5rem 1rem;
      cursor: pointer;
    }
    .card__button:hover {
      background: #0f766e;
    }
  \`
  .render(() => (
    <div class="card">
      <p class="card__title">Scoped card</p>
      <button type="button" class="card__button">Styled by island CSS</button>
    </div>
  ));
`;
