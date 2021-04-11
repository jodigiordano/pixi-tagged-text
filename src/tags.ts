import { isEmptyObject, last } from "./functionalUtils";
import {
  TagMatchData,
  TextStyleSet,
  AttributesList,
  TagWithAttributes,
  TaggedTextTokenPartial,
  TagStack,
  LINE_BREAK_TAG_NAME,
  CompositeToken,
  TagToken,
  TextToken,
} from "./types";

// TODO: this can probably be just a static value without all the options and parameters.
// Seems doing one pass will be enough to gather all relevant info.
// TODO: support self closing tags?

/**
 * Generates a regular expression object for identifying tags and attributes.
 * @param tagNamesToMatch List of tag-names that will be matched by the RegExp
 */
export const getTagRegex = (tagNamesToMatch: string[] = ["\\w+"]): RegExp => {
  const matchingTagNames =
    tagNamesToMatch.join("|") + "|" + LINE_BREAK_TAG_NAME;

  const captureGroup = (a: string) => `(${a})`;
  const noCaptureGroup = (a: string) => `(?:${a})`;

  const OR = "|";
  const WHITESPACE = `\\s`;
  const S = WHITESPACE + "*";
  const SS = WHITESPACE + "+";
  const CHAR = "[A-Za-z0-9_\\-]";
  const QUOTE = noCaptureGroup(`"|'`);
  const NOT_QUOTE = `[^${QUOTE}]`;
  const TAG_NAMES = captureGroup(matchingTagNames);
  const ATTRIBUTE_NAME = CHAR + "+";
  const ATTRIBUTE_VALUE = NOT_QUOTE + "+";

  const ATTRIBUTES =
    captureGroup(
      noCaptureGroup(
        SS +
          noCaptureGroup(ATTRIBUTE_NAME) +
          `=` +
          QUOTE +
          noCaptureGroup(ATTRIBUTE_VALUE) +
          QUOTE
      ) + "*"
    ) + "+";
  const TAG_OPEN = `<` + TAG_NAMES + ATTRIBUTES + S + `>`;
  const TAG_CLOSE = `</${TAG_NAMES}${S}>`;

  const pattern = TAG_OPEN + OR + TAG_CLOSE;

  return new RegExp(pattern, "g");
};

/**
 * Takes a string of attributes and returns an object with key value pairs for each attribute.
 * Converts "true" | "false" into booleans and number-like strings into numbers.
 * @param attributesString  XML style attributes like "src='/image.png' alt='foo'"
 */
export const parseAttributes = (attributesString = ""): AttributesList => {
  if (attributesString === "") {
    return {};
  }

  const attributes = attributesString.trim().split(/\s+/);

  return attributes.reduce((obj: AttributesList, attribute: string) => {
    const attributePair = attribute.split("=");
    const name = attributePair[0].trim();
    const valueStr: string = attributePair[1]
      .substr(1, attributePair[1].length - 2)
      .trim();

    obj[name] = valueStr;
    return obj;
  }, {});
};

/** Converts from RegExpExecArray to TagMatchData */
export const createTagMatchData = (match: RegExpExecArray): TagMatchData => {
  const {
    0: tag,
    1: openTagName,
    2: attributes,
    3: closeTagName,
    index,
  } = match;
  const tagName = openTagName ?? closeTagName;
  const isOpening = openTagName !== undefined;
  return {
    tag,
    tagName,
    isOpening,
    attributes: parseAttributes(attributes),
    index,
  };
};

/** Converts TagMatchData to TagWithAttributes */
export const tagMatchDataToTagWithAttributes = (
  tag: TagMatchData
): TagWithAttributes => ({
  tagName: tag.tagName,
  attributes: tag.attributes,
});

export const createToken = (
  text = "",
  tags: TagWithAttributes[] = []
): TaggedTextTokenPartial => ({
  text,
  tags,
});

const splitWords = (input: string): string[] =>
  input.split(" ").map((s, i, { length }) => s + (i < length - 1 ? " " : ""));

const splitTokensIntoWords = (
  tokens: TaggedTextTokenPartial[]
): TaggedTextTokenPartial[] =>
  tokens.flatMap(({ text, tags }) =>
    splitWords(text).map((word) => createToken(word, tags))
  );

export const createTokens = (
  segments: string[],
  tags: TagMatchData[]
): TaggedTextTokenPartial[] => {
  // Add the entire text with no tag as a default value in case there are no tags.
  const firstSegmentWithoutTags: TaggedTextTokenPartial = createToken(
    segments[0]
  );
  const tokens: TaggedTextTokenPartial[] = [firstSegmentWithoutTags];

  // Track which tags are opened and closed and add them to the list.
  const activeTags: TagStack = [];
  for (let i = 0; i < tags.length; i++) {
    const tag = tags[i];
    const segment = segments[i + 1] ?? "";
    if (tag.isOpening) {
      activeTags.push(tag);
    } else {
      const poppedTag = activeTags.pop();
      if (poppedTag === undefined || poppedTag.tagName !== tag.tagName) {
        throw new Error(
          `Unexpected tag nesting. Found a closing tag "${tag.tag}" that doesn't match the previously open tag "${poppedTag?.tag}"`
        );
      }
    }

    tokens.push(
      createToken(segment, activeTags.map(tagMatchDataToTagWithAttributes))
    );
  }
  if (activeTags.length > 0) {
    console.warn(
      `Found ${activeTags.length} unclosed tags in\n${activeTags
        .map((tag) => tag.tagName)
        .join("-")}`
    );
  }

  return splitTokensIntoWords(tokens);
};

/**
 * Splits original text into an untagged list of string segments.
 * @param input Original text input
 * @param tagMatchData Results of regexp exect converted to tag matches.
 */
export const extractSegments = (
  input: string,
  tagMatchData: TagMatchData[]
): string[] => {
  const segments: string[] = [];

  let remaining = input;
  let offset = 0;
  let tagMatch: TagMatchData;
  for (tagMatch of tagMatchData) {
    if (remaining !== undefined) {
      const { tag, index } = tagMatch;
      const startOfTag = index - offset;
      const endOfTag = startOfTag + tag.length;
      offset += endOfTag;

      const segment = remaining.substr(0, startOfTag);
      segments.push(segment);

      remaining = remaining.substr(endOfTag);
    }
  }
  segments.push(remaining);

  return segments;
};

const selfClosingTagSearch = (() => {
  const group = (s: string) => `(${s})`;
  const any = (s: string) => s + `*`;
  const not = (...s: string[]) => `[^${s.join("")}]`;
  const WORD_START = `[A-Za-z]`;
  const WORD = `[A-Za-z0-9]`;
  const TAG_OPEN = `<`;
  const TAG_SLASH = `/`;
  const TAG_CLOSE = `>`;
  const TAG_SELF_CLOSE = TAG_SLASH + TAG_CLOSE;

  return new RegExp(
    TAG_OPEN +
      // tag group
      group(WORD_START + any(WORD)) +
      // attribute group
      group(any(not(TAG_SLASH, TAG_CLOSE))) +
      TAG_SELF_CLOSE,
    `gs`
  );
})();
export const replaceSelfClosingTags = (input: string): string =>
  input.replace(selfClosingTagSearch, (_, tag, attributes = "") => {
    let output = `<${tag}${attributes}></${tag}>`;
    output = output.replace(/\s+/g, " ");
    output = output.replace(/\s>/g, ">");
    return output;
  });

/**
 * Replaces \n with special tags that will be recognized by the parser.
 */
export const replaceLineBreaks = (input: string): string =>
  input.replace(/\n/g, `<${LINE_BREAK_TAG_NAME}></${LINE_BREAK_TAG_NAME}>`);

/**
 * Converts a string into a list of tokens that match segments of text with styles.
 *
 * @param input Input string with XML-style tags.
 * @param tagStyles Used to only tokenize tags that have styles defined for them.
 */
export const parseTags = (
  input: string,
  tagStyles?: TextStyleSet
): TaggedTextTokenPartial[] => {
  // TODO: Warn the user if tags were found that are not defined in the tagStyles.
  const tagNames = tagStyles ? Object.keys(tagStyles) : undefined;

  input = replaceSelfClosingTags(input);
  input = replaceLineBreaks(input);
  const re = getTagRegex(tagNames);
  const matchesRaw: RegExpExecArray[] = [];
  const tagMatches: TagMatchData[] = [];
  let match;
  while ((match = re.exec(input))) {
    matchesRaw.push(match);

    const tagMatch = createTagMatchData(match);
    tagMatches.push(tagMatch);
  }

  const segments = extractSegments(input, tagMatches);

  const tokens = createTokens(segments, tagMatches);

  return tokens;
};

export const removeTags = (input: string): string =>
  input.replace(getTagRegex(), "");

// export const isTextToken = (token: Token): boolean => typeof token === "string";
// export const isWhitespaceToken = (token: Token): boolean =>
//   isTextToken(token) &&
//   token !== "" &&
//   (token as string).split("").every((s) => s.search(/\s/) === 0);
// export const isNewlineToken = (token: Token): boolean =>
//   isWhitespaceToken(token) && token === "\n";
// export const isCompositeToken = (token: Token): boolean =>
//   isTextToken(token) === false && "children" in (token as CompositeToken);

// export const makeSpacesSeparateWords = (segment: string): string[] =>
//   segment.replace(" ", "__SPACE__ __SPACE__").split("__SPACE__");

export const tagMatchToTagToken = (tag: TagMatchData): TagToken => {
  return {
    tag: tag.tagName,
    children: [],

    // Add attributes unless undefined
    ...(isEmptyObject(tag.attributes) ? {} : { attributes: tag.attributes }),
  };
};

export const createTokensNew = (
  segments: string[],
  tags: TagMatchData[]
): (TagToken | TextToken)[] => {
  const rootTokens: CompositeToken<TagToken | TextToken> = { children: [] };
  if (segments[0] !== "") {
    rootTokens.children.push(segments[0]);
  }
  // Track which tags are opened and closed and add them to the list.
  const tokenStack: TagToken[] = [rootTokens];

  for (let i = 0; i < tags.length; i++) {
    const tag = tags[i];
    const segment = segments[i + 1] ?? "";
    if (tag.isOpening) {
      const token = tagMatchToTagToken(tag);
      if (segment !== "") {
        token.children.push(segment);
      }
      last(tokenStack).children.push(token);
      tokenStack.push(token as CompositeToken<TagToken | TextToken>);
    } else {
      const poppedToken = tokenStack.pop();
      if (poppedToken === undefined || poppedToken.tag !== tag.tagName) {
        throw new Error(
          `Unexpected tag nesting. Found a closing tag "${tag.tagName}" that doesn't match the previously open tag "${poppedToken?.tag}"`
        );
      }
      if (segment !== "") {
        last(tokenStack).children.push(segment);
      }
    }
  }
  if (tokenStack.length > 1) {
    console.warn(
      `Found ${tokenStack.length - 1} unclosed tags in\n${tokenStack
        .map((token) => token.tag)
        .join("-")}`
    );
  }

  return rootTokens.children;
};

export const parseTagsNew = (
  input: string,
  matchedTagNames?: string[]
): CompositeToken<TagToken | TextToken> => {
  // TODO: Warn the user if tags were found that are not defined in the tagStyles.

  input = replaceSelfClosingTags(input);
  // input = replaceLineBreaks(input);
  const re = getTagRegex(matchedTagNames);
  const matchesRaw: RegExpExecArray[] = [];
  const tagMatches: TagMatchData[] = [];
  let match;
  while ((match = re.exec(input))) {
    matchesRaw.push(match);

    const tagMatch = createTagMatchData(match);
    tagMatches.push(tagMatch);
  }

  const segments = extractSegments(input, tagMatches);

  const tokens = createTokensNew(segments, tagMatches);

  return { children: tokens };
};
