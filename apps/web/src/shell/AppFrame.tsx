import type { ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { ROUTES } from '../app/routes';
import { UpdatePrompt } from './UpdatePrompt';

/**
 * The persistent frame. Navigation lives at the BOTTOM (ADR-0013): the user is
 * holding a weight in one hand, so every frequent target sits in the reachable
 * third of the screen. Never move this to a top bar or a hamburger.
 */
export function AppFrame({ children }: { children: ReactNode }) {
  return (
    <div className="ff-frame">
      <main className="ff-main">{children}</main>
      <UpdatePrompt />
      <nav className="ff-navbar" aria-label="Sections">
        <NavLink to={ROUTES.workout} className="ff-navtab">Train</NavLink>
        <NavLink to={ROUTES.nutrition} className="ff-navtab">Eat</NavLink>
        <NavLink to={ROUTES.insights} className="ff-navtab">Progress</NavLink>
        <NavLink to={ROUTES.more} className="ff-navtab">More</NavLink>
      </nav>
    </div>
  );
}
