import { NavLink } from 'react-router-dom'

// A segmented control between sibling homes — Teams↔Players, Oracle↔AI Lab.
// The mobile bar carries five tabs (the FotMob shape), so the two routes that
// left it must stay one obvious tap away rather than becoming lore.
export default function SiblingNav({ items }) {
  return (
    <div className="mb-4 flex rounded-lg border border-white/5 bg-pitch-800 p-1" role="tablist">
      {items.map(({ to, label, end }) => (
        <NavLink key={to} to={to} end={end} role="tab"
          className={({ isActive }) =>
            `min-h-[40px] flex-1 rounded-md px-3 py-2 text-center text-xs font-semibold transition-colors ${
              isActive ? 'bg-brand/10 text-brand' : 'text-pitch-400 hover:text-white'
            }`}>
          {label}
        </NavLink>
      ))}
    </div>
  )
}
