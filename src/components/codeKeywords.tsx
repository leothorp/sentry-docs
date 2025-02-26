import {
  Children,
  cloneElement,
  Fragment,
  ReactElement,
  useContext,
  useState,
} from 'react';
import {createPortal} from 'react-dom';
import {ArrowDown} from 'react-feather';
import {usePopper} from 'react-popper';
import styled from '@emotion/styled';
import {AnimatePresence, motion} from 'framer-motion';
import memoize from 'lodash/memoize';

import {useOnClickOutside} from 'sentry-docs/clientUtils';

import {CodeContext, createOrgAuthToken} from './codeContext';

const KEYWORDS_REGEX = /\b___(?:([A-Z_][A-Z0-9_]*)\.)?([A-Z_][A-Z0-9_]*)___\b/g;

const ORG_AUTH_TOKEN_REGEX = /___ORG_AUTH_TOKEN___/g;

type ChildrenItem = ReturnType<typeof Children.toArray>[number] | React.ReactNode;

export function makeKeywordsClickable(children: React.ReactNode) {
  const items = Children.toArray(children);

  return items.reduce((arr: ChildrenItem[], child) => {
    if (typeof child !== 'string') {
      const updatedChild = cloneElement(
        child as ReactElement,
        {},
        makeKeywordsClickable((child as ReactElement).props.children)
      );
      arr.push(updatedChild);
      return arr;
    }
    if (ORG_AUTH_TOKEN_REGEX.test(child)) {
      makeOrgAuthTokenClickable(arr, child);
    } else if (KEYWORDS_REGEX.test(child)) {
      makeProjectKeywordsClickable(arr, child);
    } else {
      arr.push(child);
    }

    return arr;
  }, [] as ChildrenItem[]);
}

function makeOrgAuthTokenClickable(arr: ChildrenItem[], str: string) {
  runRegex(arr, str, ORG_AUTH_TOKEN_REGEX, lastIndex => (
    <OrgAuthTokenCreator key={`org-token-${lastIndex}`} />
  ));
}

function makeProjectKeywordsClickable(arr: ChildrenItem[], str: string) {
  runRegex(arr, str, KEYWORDS_REGEX, (lastIndex, match) => (
    <KeywordSelector
      key={`project-keyword-${lastIndex}`}
      index={lastIndex}
      group={match[1] || 'PROJECT'}
      keyword={match[2]}
    />
  ));
}

function runRegex(
  arr: ChildrenItem[],
  str: string,
  regex: RegExp,
  cb: (lastIndex: number, match: any[]) => React.ReactNode
): void {
  regex.lastIndex = 0;

  let match;
  let lastIndex = 0;
  // eslint-disable-next-line no-cond-assign
  while ((match = regex.exec(str)) !== null) {
    const afterMatch = regex.lastIndex - match[0].length;
    const before = str.substring(lastIndex, afterMatch);

    if (before.length > 0) {
      arr.push(before);
    }

    arr.push(cb(lastIndex, match));

    lastIndex = regex.lastIndex;
  }

  const after = str.substring(lastIndex);
  if (after.length > 0) {
    arr.push(after);
  }
}

const getPortal = memoize((): HTMLElement | null => {
  if (typeof document === 'undefined') {
    return null;
  }

  let portal = document.getElementById('selector-portal');
  if (!portal) {
    portal = document.createElement('div');
    portal.setAttribute('id', 'selector-portal');
    document.body.appendChild(portal);
  }
  return portal;
});

type KeywordSelectorProps = {
  group: string;
  index: number;
  keyword: string;
};

type TokenState =
  | {status: 'none'}
  | {status: 'loading'}
  | {status: 'success'; token: string}
  | {status: 'error'};

const dropdownPopperOptions = {
  placement: 'bottom' as const,
  modifiers: [
    {
      name: 'offset',
      options: {offset: [0, 10]},
    },
    {name: 'arrow'},
  ],
};

function OrgAuthTokenCreator() {
  const [tokenState, setTokenState] = useState<TokenState>({status: 'none'});
  const [isOpen, setIsOpen] = useState(false);
  const [referenceEl, setReferenceEl] = useState<HTMLSpanElement | null>(null);
  const [dropdownEl, setDropdownEl] = useState<HTMLElement | null>(null);
  const {styles, state, attributes} = usePopper(
    referenceEl,
    dropdownEl,
    dropdownPopperOptions
  );
  const [isAnimating, setIsAnimating] = useState(false);

  useOnClickOutside({
    ref: {current: referenceEl},
    enabled: isOpen,
    handler: () => setIsOpen(false),
  });

  const updateSelectedOrg = (orgSlug: string) => {
    const choices = codeKeywords.PROJECT ?? [];
    const currentSelectionIdx = sharedSelection.PROJECT ?? 0;
    const currentSelection = choices[currentSelectionIdx];

    // Already selected correct org, nothing to do
    if (currentSelection && currentSelection.ORG_SLUG === orgSlug) {
      return;
    }

    // Else, select first project of the selected org
    const newSelectionIdx = choices.findIndex(choice => choice.ORG_SLUG === orgSlug);
    if (newSelectionIdx > -1) {
      const newSharedSelection = {...sharedSelection};
      newSharedSelection.PROJECT = newSelectionIdx;
      setSharedSelection(newSharedSelection);
    }
  };

  const createToken = async (orgSlug: string) => {
    setTokenState({status: 'loading'});
    const token = await createOrgAuthToken({
      orgSlug,
      name: `Generated by Docs on ${new Date().toISOString().slice(0, 10)}`,
    });

    if (token) {
      setTokenState({
        status: 'success',
        token,
      });

      updateSelectedOrg(orgSlug);
    } else {
      setTokenState({
        status: 'error',
      });
    }
  };

  const codeContext = useContext(CodeContext);
  if (!codeContext) {
    return null;
  }
  const {codeKeywords, sharedKeywordSelection} = codeContext;
  const [sharedSelection, setSharedSelection] = sharedKeywordSelection;

  const orgSet = new Set<string>();
  codeKeywords?.PROJECT?.forEach(projectKeyword => {
    orgSet.add(projectKeyword.ORG_SLUG);
  });
  const orgSlugs = [...orgSet];

  if (!codeKeywords.USER) {
    // User is not logged in - show dummy token
    return <Fragment>sntrys_YOUR_TOKEN_HERE</Fragment>;
  }

  if (tokenState.status === 'success') {
    return <Fragment>{tokenState.token}</Fragment>;
  }

  if (tokenState.status === 'error') {
    return <Fragment>There was an error while generating your token.</Fragment>;
  }

  if (tokenState.status === 'loading') {
    return <Fragment>Generating token...</Fragment>;
  }

  const selector = isOpen && (
    <PositionWrapper style={styles.popper} ref={setDropdownEl} {...attributes.popper}>
      <AnimatedContainer>
        <Dropdown>
          <Arrow
            style={styles.arrow}
            data-placement={state?.placement}
            data-popper-arrow
          />
          <DropdownHeader>Select an organization:</DropdownHeader>
          <Selections>
            {orgSlugs.map(org => {
              return (
                <ItemButton
                  data-sentry-mask
                  key={org}
                  isActive={false}
                  onClick={() => {
                    createToken(org);
                    setIsOpen(false);
                  }}
                >
                  {org}
                </ItemButton>
              );
            })}
          </Selections>
        </Dropdown>
      </AnimatedContainer>
    </PositionWrapper>
  );

  const portal = getPortal();

  const handlePress = () => {
    if (orgSlugs.length === 1) {
      createToken(orgSlugs[0]);
    } else {
      setIsOpen(!isOpen);
    }
  };

  return (
    <Fragment>
      <KeywordDropdown
        ref={setReferenceEl}
        role="button"
        title="Click to generate token"
        tabIndex={0}
        onClick={() => {
          handlePress();
        }}
        onKeyDown={e => {
          if (['Enter', 'Space'].includes(e.key)) {
            handlePress();
          }
        }}
      >
        <span
          style={{
            // We set inline-grid only when animating the keyword so they
            // correctly overlap during animations, but this must be removed
            // after so copy-paste correctly works.
            display: isAnimating ? 'inline-grid' : undefined,
          }}
        >
          <AnimatePresence initial={false}>
            <Keyword
              onAnimationStart={() => setIsAnimating(true)}
              onAnimationComplete={() => setIsAnimating(false)}
            >
              Click to generate token
            </Keyword>
          </AnimatePresence>
        </span>
      </KeywordDropdown>
      {portal && createPortal(<AnimatePresence>{selector}</AnimatePresence>, portal)}
    </Fragment>
  );
}

function KeywordSelector({keyword, group, index}: KeywordSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [referenceEl, setReferenceEl] = useState<HTMLSpanElement | null>(null);
  const [dropdownEl, setDropdownEl] = useState<HTMLElement | null>(null);
  const [isAnimating, setIsAnimating] = useState(false);

  const {styles, state, attributes} = usePopper(
    referenceEl,
    dropdownEl,
    dropdownPopperOptions
  );

  useOnClickOutside({
    ref: {current: referenceEl},
    enabled: isOpen,
    handler: () => setIsOpen(false),
  });

  const codeContext = useContext(CodeContext);
  if (!codeContext) {
    return null;
  }

  const [sharedSelection, setSharedSelection] = codeContext.sharedKeywordSelection;

  const {codeKeywords} = codeContext;
  const choices = codeKeywords?.[group] ?? [];
  const currentSelectionIdx = sharedSelection[group] ?? 0;
  const currentSelection = choices[currentSelectionIdx];

  if (!currentSelection) {
    return <Fragment>keyword</Fragment>;
  }

  const selector = isOpen && (
    <PositionWrapper style={styles.popper} ref={setDropdownEl} {...attributes.popper}>
      <AnimatedContainer>
        <Dropdown>
          <Arrow
            style={styles.arrow}
            data-placement={state?.placement}
            data-popper-arrow
          />
          <Selections>
            {choices.map((item, idx) => {
              const isActive = idx === currentSelectionIdx;
              return (
                <ItemButton
                  data-sentry-mask
                  key={idx}
                  isActive={isActive}
                  onClick={() => {
                    const newSharedSelection = {...sharedSelection};
                    newSharedSelection[group] = idx;
                    setSharedSelection(newSharedSelection);
                    setIsOpen(false);
                  }}
                >
                  {item.title}
                </ItemButton>
              );
            })}
          </Selections>
        </Dropdown>
      </AnimatedContainer>
    </PositionWrapper>
  );

  const portal = getPortal();

  return (
    <Fragment>
      <KeywordDropdown
        key={index}
        ref={setReferenceEl}
        role="button"
        tabIndex={0}
        title={currentSelection?.title}
        onClick={() => setIsOpen(!isOpen)}
        onKeyDown={e => e.key === 'Enter' && setIsOpen(!isOpen)}
      >
        <KeywordIndicator isOpen={isOpen} />
        <span
          style={{
            // We set inline-grid only when animating the keyword so they
            // correctly overlap during animations, but this must be removed
            // after so copy-paste correctly works.
            display: isAnimating ? 'inline-grid' : undefined,
          }}
        >
          <AnimatePresence initial={false}>
            <Keyword
              onAnimationStart={() => setIsAnimating(true)}
              onAnimationComplete={() => setIsAnimating(false)}
              key={currentSelectionIdx}
            >
              {currentSelection[keyword]}
            </Keyword>
          </AnimatePresence>
        </span>
      </KeywordDropdown>
      {portal && createPortal(<AnimatePresence>{selector}</AnimatePresence>, portal)}
    </Fragment>
  );
}

const Keyword = styled(motion.span)`
  grid-row: 1;
  grid-column: 1;
`;

Keyword.defaultProps = {
  initial: {position: 'absolute', opacity: 0, y: -10},
  animate: {
    position: 'relative',
    opacity: 1,
    y: 0,
    transition: {delay: 0.1},
  },
  exit: {opacity: 0, y: 20},
  transition: {
    opacity: {duration: 0.15},
    y: {duration: 0.25},
  },
};

const KeywordDropdown = styled('span')`
  border-radius: 3px;
  margin: 0 2px;
  padding: 0 4px;
  z-index: -1;
  cursor: pointer;
  background: #382f5c;
  transition: background 200ms ease-in-out;

  &:focus {
    outline: none;
  }

  &:focus,
  &:hover {
    background: #1d1127;
  }
`;

const KeywordIndicator = styled(ArrowDown, {shouldForwardProp: p => p !== 'isOpen'})<{
  isOpen: boolean;
}>`
  user-select: none;
  margin-right: 2px;
  transition: transform 200ms ease-in-out;
  transform: rotate(${p => (p.isOpen ? '180deg' : '0')});
  stroke-width: 3px;
  position: relative;
  top: -1px;
`;

KeywordIndicator.defaultProps = {
  size: '12px',
};

const PositionWrapper = styled('div')`
  z-index: 100;
`;

const Arrow = styled('div')`
  position: absolute;
  width: 10px;
  height: 5px;
  margin-top: -10px;

  &::before {
    content: '';
    display: block;
    border: 5px solid transparent;
  }

  &[data-placement*='bottom'] {
    &::before {
      border-bottom-color: #fff;
    }
  }

  &[data-placement*='top'] {
    bottom: -5px;
    &::before {
      border-top-color: #fff;
    }
  }
`;

const Dropdown = styled('div')`
  overflow: hidden;
  border-radius: 3px;
  background: #fff;
  box-shadow: 0 0 10px rgba(0, 0, 0, 0.1);
`;

const Selections = styled('div')`
  padding: 4px 0;
  overflow: scroll;
  overscroll-behavior: contain;
  max-height: 210px;
  min-width: 300px;
`;

const AnimatedContainer = styled(motion.div)``;

AnimatedContainer.defaultProps = {
  initial: {opacity: 0, y: 5},
  animate: {opacity: 1, y: 0},
  exit: {opacity: 0, scale: 0.95},
  transition: {
    opacity: {duration: 0.15},
    y: {duration: 0.3},
    scale: {duration: 0.3},
  },
};

const DropdownHeader = styled('div')`
  padding: 4px 8px;
  color: #80708f;
  background-color: #fff;
  border-bottom: 1px solid #dbd6e1;
`;

const ItemButton = styled('button')<{isActive: boolean}>`
  font-family:
    'Rubik',
    -apple-system,
    BlinkMacSystemFont,
    'Segoe UI';
  font-size: 0.85rem;
  text-align: left;
  padding: 2px 8px;
  display: block;
  width: 100%;
  background: none;
  border: none;
  outline: none;

  &:not(:last-child) {
    border-bottom: 1px solid #eee;
  }

  &:focus {
    outline: none;
    background: #eee;
  }

  ${p =>
    p.isActive
      ? `
    background-color: #6C5FC7;
    color: #fff;
  `
      : `
    &:hover,
    &.active {
      background-color: #FAF9FB;
    }
  `}
`;
