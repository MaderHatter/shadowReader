import { workspace, ExtensionContext, window } from "vscode";
import { setStatusBarMsg } from "./util";
import { BookKind, BookStore } from "./parse/model";
import { Parser as LocalParser, Parser } from "./parse/interface";
import { TxtFileParser } from "./parse/txt";
import { CrawelerDomains } from "./const";
import { BiquWebParser } from "./parse/biqu";
import { CaimoWebParser } from "./parse/caimo";

let bookPath: string = "";
let parser: Parser;
const readEOFTip = "";
let preSearchResults: Map<string, number>;
let preSearchKeyWord: string;


function loadParser(context: ExtensionContext, bookPath: string): LocalParser {
  let store = context.globalState.get(bookPath, 0);
  parser = new TxtFileParser(bookPath, context.globalState.get(bookPath, 0));

  let bookStore: BookStore;
  // compatible old version
  if (typeof store === "number") {
    bookStore = {
      kind: BookKind.local,
      readedCount: store,
    };
  } else {
    bookStore = store as BookStore;
  }

  switch (bookStore.kind) {
    case BookKind.local:
      return new TxtFileParser(bookPath, bookStore.readedCount);

    case BookKind.online:
      if (bookStore.sectionPath?.startsWith(<string>CrawelerDomains.get("biquURL"))) {
        return new BiquWebParser(<string>bookStore.sectionPath, bookStore.readedCount, bookPath);
      } else if (bookStore.sectionPath?.startsWith(<string>CrawelerDomains.get("caimoURL"))) {
        return new CaimoWebParser(<string>bookStore.sectionPath, bookStore.readedCount, bookPath);
      }
      throw new Error("book url is not supported");
    default:
      throw new Error("book kind is not supported");
  }
}

export async function readNextLine(context: ExtensionContext): Promise<string> {
  let pageSize: number = <number>workspace.getConfiguration().get("statusbarReader.pageSize");
  let content = await parser.getNextPage(pageSize);
  if (content.length === 0) {
    return readEOFTip;
  }
  let percent = parser.getPercent();
  context.globalState.update(bookPath, parser.getPersistHistory());
  return `${content}   ${percent}`;
}

export async function readPrevLine(context: ExtensionContext): Promise<string> {
  let pageSize: number = <number>workspace.getConfiguration().get("statusbarReader.pageSize");
  let content = await parser.getPrevPage(pageSize);
  let percent = parser.getPercent();
  context.globalState.update(bookPath, parser.getPersistHistory());
  return `${content}   ${percent}`;
}

export function closeAll(): void {
  if (parser) {
    parser.close();
  }
}

export function loadFile(context: ExtensionContext, newfilePath: string) {
  if (parser) {
    parser.close();
  }
  parser = loadParser(context, newfilePath);
  bookPath = newfilePath;
  let text = readNextLine(context).then(text => {
    setStatusBarMsg(text);
  });
}

export async function searchContent(context: ExtensionContext, keyword: string): Promise<string> {
  let keywordIndex = 0;
  let results: Map<string, number> = new Map();
  let result: string = "";
  let pageSize: number = <number>workspace.getConfiguration().get("statusbarReader.pageSize");
  let maxSearchCount: number = <number>workspace.getConfiguration().get("statusbarReader.maxSearchCount");
  let count: number = 0;
  while (true) {
    if(keyword === preSearchKeyWord){
      results = preSearchResults;
      break;
    }
    let [content, bufferSize] = await parser.getPage(pageSize, count);
    count += bufferSize;
    if (content.length === 0 && bufferSize === 0) {
      break;
    }

    if(results.size >= maxSearchCount){
      results.set("搜索结果过多, 请详细关键字", 0);
      break;
    }
    

    for (let char of content) {
      if (char === keyword[keywordIndex]) {
        keywordIndex++;
        if (keywordIndex === keyword.length) {
          results.set(content, count);
        }
      } else {
        keywordIndex = 0;
      }
    }
  }
  preSearchResults = results;
  preSearchKeyWord = keyword;
  const quickPickItems = Array.from(results).map(([content, count]) => ({ label: content, description: count.toString() }));
  await window.showQuickPick(quickPickItems).then(text => {
    if (text !== undefined) {
      let percent = parser.getPercentFromInputIndex(Number(text?.description));
      parser.setReadCount(Number(text?.description));
      context.globalState.update(bookPath, parser.getPersistHistory());
      result =  `${text?.label} ${percent}`;
    }
  });
  return result;
}