export function Polaroid({
  image,
  title,
  small = false,
}: {
  image: string;
  title: string;
  small?: boolean;
}) {
  return (
    <figure className={`encounter-polaroid${small ? " small" : ""}`}>
      <img
        src={image}
        alt={title || "Photo sélectionnée"}
        loading={small ? "lazy" : "eager"}
        decoding="async"
      />
      <figcaption>{title || "Bientôt dans ton carnet."}</figcaption>
    </figure>
  );
}
