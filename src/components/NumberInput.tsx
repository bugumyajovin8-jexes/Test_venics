/**
 * A number field that cannot be changed by accident.
 *
 * `<input type="number">` offers three ways to alter a figure nobody meant to
 * touch. The spinner arrows are handled in index.css, for every number field
 * at once. The other two need JavaScript, and this is where they live:
 *
 *   the scroll wheel   increments the value whenever the field holds focus.
 *                      Type 20, roll the wheel to read the rest of the form,
 *                      and it now says 17 with nothing on screen to say so.
 *   the up/down keys   step it by one. Reaching for Tab or Enter and catching
 *                      an arrow instead is the same accident by another route.
 *
 * On a price or a payment amount that is a wrong figure on a document somebody
 * keeps, which is why this is a component rather than a note in a review.
 *
 * The wheel is handled by blurring rather than by cancelling the event. It
 * looks like the timid option and is the better one: cancelling stops the
 * value changing but also eats the scroll, so the page appears to jam wherever
 * the pointer rests — badly so on a Mac, where one trackpad flick sends a long
 * tail of wheel events. Blurring lets the same gesture scroll the page,
 * because an unfocused number input has nothing to increment.
 *
 * The keys are refused outright, since there is nothing to blur. Left and
 * right still move the caret and every other key types as normal.
 *
 * A drop-in for <input type="number">: it takes the same props, so a field
 * becomes safe by changing the tag and nothing else.
 */
export default function NumberInput({
  onWheel,
  onKeyDown,
  ...props
}: React.ComponentProps<'input'>) {
  return (
    <input
      {...props}
      type="number"
      onWheel={(e) => {
        // Only when it is the focused field: a pointer merely crossing a form
        // on its way down the page must not be interfered with.
        if (document.activeElement === e.currentTarget) e.currentTarget.blur();
        onWheel?.(e);
      }}
      onKeyDown={(e) => {
        if (e.key === 'ArrowUp' || e.key === 'ArrowDown') e.preventDefault();
        onKeyDown?.(e);
      }}
    />
  );
}
