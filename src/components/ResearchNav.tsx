import { useEffect, useMemo, useState } from 'react'
import {
  LENS_GROUPS,
  PRIMARY_DOSSIER_IDS,
  PRIMARY_DOSSIERS,
  groupForTab,
  lensForTab,
  type TabId,
} from '../navigation'

const GROUPED_LENSES = LENS_GROUPS.filter((group) => group.id !== 'regions')
const primaryDossierIds = new Set<string>(PRIMARY_DOSSIER_IDS)

export default function ResearchNav({
  activeTab,
  onSelect,
}: {
  activeTab: string
  onSelect: (tab: TabId) => void
}) {
  const activeGroup = groupForTab(activeTab) ?? GROUPED_LENSES[0]
  const groupedActive = GROUPED_LENSES.find((group) => group.id === activeGroup.id)
  const [openGroupId, setOpenGroupId] = useState(groupedActive?.id ?? GROUPED_LENSES[0].id)

  useEffect(() => {
    if (groupedActive) setOpenGroupId(groupedActive.id)
  }, [groupedActive])

  const openGroup = useMemo(
    () => GROUPED_LENSES.find((group) => group.id === openGroupId) ?? GROUPED_LENSES[0],
    [openGroupId],
  )
  const activeLens = lensForTab(activeTab)
  const primaryActive = primaryDossierIds.has(activeTab)

  return (
    <nav className="research-nav" aria-label="NarcoScope research lenses">
      <div className="research-nav__inner">
        <div className="research-nav__featured" aria-label="Primary regional dossiers">
          <span className="research-nav__featured-label">BRI + regional evidence</span>
          <div className="research-nav__featured-tabs">
            {PRIMARY_DOSSIERS.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`research-nav__featured-tab ${activeTab === item.id ? 'is-active' : ''}`}
                aria-current={activeTab === item.id ? 'page' : undefined}
                onClick={() => onSelect(item.id)}
              >
                {item.shortLabel}
              </button>
            ))}
          </div>
        </div>

        <div className="research-nav__groups" aria-label="Research areas">
          {GROUPED_LENSES.map((group) => {
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

        <div className={`research-nav__deck ${primaryActive ? 'research-nav__deck--primary-active' : ''}`} id="research-lens-list">
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
