import { Link } from 'react-router-dom';
import { AppUpdateSection } from './AppUpdateSection';
import { Mark } from './Mark';
import { ROUTES } from '../app/routes';

/**
 * The fourth tab: everything that is not Train, Eat or Progress.
 *
 * It exists because several screens had no way in. `/nutrition/recipes` was
 * reachable only by typing the URL — nothing in the app linked to it — and
 * targets and custom foods were reachable only from inside the Eat tab, if you
 * already knew to look. A screen nobody can navigate to is not shipped, it is
 * just present.
 *
 * A tab rather than a header button, deliberately. The tab bar already exists,
 * so this costs no vertical space — and the visual pass fought to reclaim 159px
 * on the logging screen, which is not worth spending back on chrome that would
 * sit on every screen. A tab is also permanently visible, which is the whole
 * point for someone who does not yet know what the app contains.
 */

interface Item {
  readonly to: string;
  readonly label: string;
  readonly hint: string;
}

const EAT: readonly Item[] = [
  {
    to: `${ROUTES.nutrition}/targets`,
    label: 'Your targets',
    hint: 'Calories and macros. Worked out from four numbers, on this device.',
  },
  {
    to: `${ROUTES.nutrition}/recipes`,
    label: 'Recipes',
    hint: 'Build a meal once, then log the whole thing in one tap.',
  },
  {
    to: `${ROUTES.nutrition}/custom`,
    label: 'Add a food',
    hint: "For anything the barcode and search cannot find.",
  },
];

export function MoreScreen() {
  return (
    <div className="ff-more">
      <header className="ff-more__head">
        <h1 className="ff-more__title">
          <Mark size={28} />
          More
        </h1>
      </header>

      <section className="ff-more__group" aria-labelledby="more-eat">
        <h2 className="ff-more__grouptitle" id="more-eat">
          Eating
        </h2>
        <ul className="ff-more__list">
          {EAT.map((item) => (
            <li key={item.to}>
              <Link className="ff-more__item ff-focusable" to={item.to}>
                <span className="ff-more__label">{item.label}</span>
                <span className="ff-more__hint">{item.hint}</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <AppUpdateSection />

      <section className="ff-more__group" aria-labelledby="more-about">
        <h2 className="ff-more__grouptitle" id="more-about">
          How this works
        </h2>
        <div className="ff-more__prose">
          <p>
            <strong>Train</strong> is the session you are in right now. Add a lift, tap the number
            to change it, tap the circle to log the set. Next time, last week&apos;s numbers are
            already filled in — so a repeat set is one tap.
          </p>
          <p>
            <strong>Eat</strong> is today&apos;s food. Scan a barcode, search, or add it by hand.
            Anything you log once becomes a one-tap shortcut.
          </p>
          <p>
            <strong>Progress</strong> fills in from what you log. It is calculated on this device
            from your own sessions and nothing else.
          </p>
          <p className="ff-more__note">
            Everything is stored on this device. There is no account, nothing is uploaded, and
            there is nothing to pay for — now or later.
          </p>
        </div>
      </section>
    </div>
  );
}
