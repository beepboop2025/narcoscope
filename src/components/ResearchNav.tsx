import { useEffect, useMemo, useState } from 'react'
import { LENS_GROUPS, groupForTab, lensForTab, type TabId } from '../navigation'

export default function ResearchNav({
  activeTab,
  onSelect,
}: {
  activeTab: string
  onSelect: (tab: TabId) => void
}) {
  const activeGroup = groupForTab(activeTab) ?? LENS_GROUPS[0]
  const [openGroupId, setOpenGroupId] = useState(activeGroup.id)

  useEffect(() => setOpenGroupId(activeGroup.id), [activeGroup.id])

  const openGroup = useMemo(
    () => LENS_GROUPS.find((group) => group.id === openGroupId) ?? activeGroup,
    [activeGroup, openGroupId],
  )
  const activeLens = lensForTab(activeTab)

  return (
    <nav className="research-nav" aria-label="NarcoScope research lenses">
      <div className="research-nav__inner">
        <div className="research-nav__groups" aria-label="Research areas">
          {LENS_GROUPS.map((group) => {
            const isOpen = group.id === openGroup.id
            const containsActive = group.id === activeGroup.id
            return (
              <button
                key={group.id}
                type="button"
                className={`research-nav__group ${isOpen ? 'is-open' : ''} ${containsActive ? 'has-active' : ''}`}
                aria-expanded={isOpen}
                aria-controls="research-lens-list"
                onClick={() => setOpenGroupId(group.id)}
              >
                <span>{group.eyebrow}</span>
                {group.label}
              </button>
            )
          })}
        </div>

        <div className="research-nav__deck" id="research-lens-list">
          <div className="research-nav__tabs" aria-label={`${openGroup.label} views`}>
            {openGroup.items.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`research-nav__tab ${activeTab === item.id ? 'is-active' : ''}`}
                aria-current={activeTab === item.id ? 'page' : undefined}
                onClick={() => onSelect(item.id)}
              >
                {item.shortLabel}
              </button>
            ))}
          </div>
          <p className="research-nav__reading" aria-live="polite">
            <span>{activeGroup.label} / {activeLens?.shortLabel ?? 'Overview'}</span>
            {activeLens?.description}
          </p>
        </div>
      </div>
    </nav>
  )
}
