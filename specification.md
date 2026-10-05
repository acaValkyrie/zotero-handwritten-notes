# Zotero Handwritten Notes Plugin 仕様書

## 1. 目的

Zotero上で各論文に紐付いた「手書きノート用PDF」を作成し、iPad + Apple Pencilで手書きノートとして利用できるようにする。

想定する使い方は以下。

- PC：論文PDFを読む
- iPad：同じ論文に紐付いた手書きノートPDFへApple Pencilで書く
- 手書き内容：ZoteroのInk Annotationとして同期
- ノート作成時：白紙・横罫・方眼から用紙を選択
- ページが不足した場合：PC版Zoteroから同じ用紙のページを追加

Zoteroには手書きノート用PDFの作成やPDFへの白紙ページ追加機能がないため、PC版Zoteroのプラグインとして実装する。

---

# 2. 対象Zoteroバージョン

初期リリースでは、

> **Zotero 10.x Desktop**

を正式なサポート対象とする。

開発・テストは最新のZotero 10安定版を使用すること。

```text
Supported:
- Zotero 10.x Desktop
  - Windows
  - macOS
  - Linux

Unsupported / untested:
- Zotero 9.x以前
- Zotero Beta / Nightly / Development builds
- Zotero 11以降
- iOS/iPadOS版へのプラグイン直接インストール
```

iPad版Zoteroはプラグインの実行対象ではない。

ただし、本プラグインによって生成・変更した `Handwritten Notes.pdf` とZotero Ink Annotationが、Zotero Syncを介してiPad版Zoteroで正常に利用できることは必須要件とする。

---

# 3. 想定ワークフロー

通常の論文アイテム：

```text
Paper Item
└── paper.pdf
```

親アイテムを右クリック：

```text
Create Handwritten Notes
```

用紙選択UIを表示する。

```text
Create Handwritten Notes

Paper Style:

(●) Blank
( ) Ruled — 6 mm
( ) Grid  — 5 mm

[Cancel] [Create]
```

作成後：

```text
Paper Item
├── paper.pdf
└── Handwritten Notes.pdf
```

PCでは論文を読み、iPadでは `Handwritten Notes.pdf` を開いてApple Pencilで書く。

ページが不足した場合：

```text
Handwritten Notes.pdf
        ↓
右クリック
        ↓
Add Page
        ↓
同じPaper Styleのページを末尾へ追加
```

---

# 4. 初期バージョンの必須機能

以下の2機能を実装する。

## 4.1 Create Handwritten Notes

論文の親アイテムから手書きノートPDFを作成する。

作成時に以下の3種類から用紙を選択できること。

1. Blank
2. Ruled — 6 mm
3. Grid — 5 mm

## 4.2 Add Page

既存の手書きノートPDFの末尾にページを1ページ追加する。

原則として、そのノートを作成した際に選択したPaper Styleを引き継ぐ。

例：

```text
Ruled 6 mmのノート

Page 1  Ruled 6 mm
Page 2  Ruled 6 mm
Page 3  Ruled 6 mm

Add Page
    ↓

Page 4  Ruled 6 mm
```

---

# 5. Create Handwritten Notes

## 5.1 実行対象

通常の親アイテムを1件選択している場合に実行可能とする。

例：

```text
Journal Article
Conference Paper
Preprint
Book Section
Thesis
```

Attachmentそのものを選択している場合には表示しない、または無効化する。

複数選択は初期バージョンでは対象外。

---

# 6. 用紙選択

`Create Handwritten Notes` 実行時にPaper Style選択UIを表示する。

選択肢：

```text
Blank
Ruled — 6 mm
Grid — 5 mm
```

初期選択：

```text
Blank
```

とする。

---

# 7. Blank

完全な白紙。

背景：

```text
white
```

罫線・枠線等は一切描画しない。

ページサイズ：

```text
A4 Portrait
210 mm × 297 mm
```

PDF上では可能な限り空のページとして生成する。

---

# 8. Ruled — 6 mm

横線のみを6 mm間隔で描画する。

概念：

```text
────────────────────

────────────────────

────────────────────

────────────────────
```

線間隔：

> **6 mm**

縦線は描画しない。

ページ：

```text
A4 Portrait
210 mm × 297 mm
```

線はPDFのvector drawingとして生成する。

罫線を画像として埋め込まない。

これにより、

- PDFサイズを小さくする
- 拡大時にも罫線を鮮明にする
- 不要な画像データを持たない

ことを狙う。

線幅は手書きの邪魔にならない細さとする。

初期値の具体的な線幅・濃度については実装時に一般的なノート用紙を参考に決定する。

ただし、黒い強い線にはしない。

---

# 9. Grid — 5 mm

縦線・横線をそれぞれ5 mm間隔で描画し、正方形の方眼を生成する。

概念：

```text
┼───┼───┼───┼───┼
│   │   │   │   │
┼───┼───┼───┼───┼
│   │   │   │   │
┼───┼───┼───┼───┼
│   │   │   │   │
┼───┼───┼───┼───┼
```

間隔：

> **5 mm × 5 mm**

ページ：

```text
A4 Portrait
210 mm × 297 mm
```

縦横の線はPDFのvector drawingとして生成する。

画像として方眼を埋め込まない。

線幅・濃度についてはRuledと同様、Apple Pencilでの筆記を妨げない薄い罫線とする。

---

# 10. PDF座標への変換

PDFでは通常point単位を使用するため、mmからpointへ正確に変換する。

```text
1 inch = 25.4 mm
1 inch = 72 pt

1 mm = 72 / 25.4 pt
```

したがって、

```text
6 mm ≈ 17.0079 pt
5 mm ≈ 14.1732 pt
```

とする。

整数pixel等へ丸めて配置しない。

可能な限りPDF座標上で正確な間隔を使用する。

---

# 11. 罫線の描画範囲

罫線はページ端ギリギリまで描画せず、適切な余白を設ける。

初期実装では、

```text
Top:    10 mm
Bottom: 10 mm
Left:   10 mm
Right:  10 mm
```

程度を基準とする。

具体的な値は実装・表示確認後に調整可能とする。

重要なのは、罫線間隔そのものが、

```text
Ruled: 6 mm
Grid:  5 mm
```

から変化しないことである。

---

# 12. Paper Styleの保持

ノート作成時に選択したPaper Styleを、後から `Add Page` で利用できるよう保持する。

保持する値：

```text
blank
ruled-6mm
grid-5mm
```

保持方法については現行Zotero 10のAPIを調査する。

候補として、

- Attachmentに関連するプラグイン独自メタデータ
- Zotero itemのextra情報
- プラグイン設定/DB

等が考えられる。

ただし、ユーザーから見える通常の書誌情報を不必要に汚染しない方法を優先する。

また、

> **同期後、別のPCでもPaper Styleを判定できること**

が望ましい。

そのため、ローカルPCにしか存在しない設定への保存は可能な限り避ける。

---

# 13. Paper Styleを判定できない場合

既存PDFなど、プラグイン外で作成されたPDFではPaper Style情報が存在しない。

この場合 `Add Page` 実行時に選択UIを表示する。

```text
Add Page

Paper Style:

(●) Blank
( ) Ruled — 6 mm
( ) Grid  — 5 mm

[Cancel] [Add]
```

プラグイン自身が作成したノートについては原則として選択を要求せず、保存されたPaper Styleを利用する。

---

# 14. ファイル名

初期値：

```text
Handwritten Notes.pdf
```

同名Attachmentが存在する場合：

```text
Handwritten Notes.pdf
Handwritten Notes 2.pdf
Handwritten Notes 3.pdf
```

のように重複を回避する。

既存ファイルを上書きしてはならない。

---

# 15. Zoteroへの登録

生成したPDFは対象論文の子Attachmentとして登録する。

```text
Paper Item
├── paper.pdf
└── Handwritten Notes.pdf
```

リンクファイルではなく、原則としてZotero管理下のStored Attachmentとする。

Zotero File Sync経由でiPadへ同期できること。

---

# 16. Add Page

PDF Attachmentを選択した状態で、

```text
Add Page
```

を実行できるようにする。

プラグインによって作成されたHandwritten Notesの場合は、作成時のPaper Styleを使用する。

例：

```text
Handwritten Notes.pdf
Paper Style = grid-5mm

Page 1 → Grid 5 mm

Add Page

↓

Page 1 → Grid 5 mm
Page 2 → Grid 5 mm
```

追加位置は必ず末尾。

---

# 17. Add Page の対象

以下の場合のみ有効。

```text
選択数 = 1
AND
選択対象 = attachment
AND
MIME type = application/pdf
AND
ローカルファイルが存在する
```

通常の論文PDFにも利用可能としてよい。

ただし、その場合はPaper Style選択UIを表示する。

---

# 18. 最重要要件：既存Annotationを壊さない

PDFへのページ追加時、既存のZotero Annotationを壊さないことを最優先とする。

許可する変更：

> **PDF末尾への新規ページ追加のみ**

禁止：

- 既存ページの削除
- 既存ページの並べ替え
- 既存ページのサイズ変更
- 既存ページの回転
- 既存ページ内容の再生成
- 既存ページの再レンダリング
- PDF全体の画像化

既存ページは可能な限り元PDFのページオブジェクトをそのまま保持する。

---

# 19. Annotationの扱い

Zotero AnnotationをPDFへflattenしない。

Ink Annotation等はZotero側で管理する。

プラグインからAnnotationを、

- コピー
- 再生成
- 移動
- flatten

しない。

例えば、

```text
Page 1 → Annotation A
Page 2 → Annotation B
Page 3 → Annotation C
```

に対してページを追加すると、

```text
Page 1 → Annotation A
Page 2 → Annotation B
Page 3 → Annotation C
Page 4 → NEW
```

となる。

Annotation DB自体には原則変更を加えない。

---

# 20. Add Page時のページサイズ

追加ページは直前の最終ページと同じMediaBoxを使用する。

ただし、Paper Styleの物理間隔は実際のページ寸法に基づいて計算する。

例えばA4以外のPDFへGridを追加した場合でも、

```text
5 mm = 14.1732 pt
```

を維持する。

CropBoxやRotationについても、安全にコピー可能であれば最終ページと一致させる。

---

# 21. PDF処理

PDF操作ライブラリは現行Zoteroプラグイン環境で利用可能かつ保守しやすいものを選択する。

有力候補：

```text
pdf-lib
```

既存Zoteroプラグインでpdf-libを使用している実例が存在するため、参考にする。

ただし実装前に、

- Zotero 10で利用可能か
- bundled dependencyとして同梱可能か
- 既存ページを保持してページ追加できるか
- vector lineを生成できるか
- ライセンス

を確認する。

---

# 22. ファイル更新

安全のため、

```text
元PDF
 ↓
読み込み
 ↓
ページ追加
 ↓
一時ファイルへ保存
 ↓
PDFとして再読み込みしてvalidation
 ↓
元PDFを置換
```

とする。

途中で失敗した場合は元PDFを変更しない。

---

# 23. Zoteroへの変更通知

PDFを作成・変更したあと、Zoteroが変更を認識してFile Sync対象にできるようにする。

現行Zotero 10 APIを調査して適切な方法を利用する。

`zotero.sqlite` をZotero外部から直接変更しない。

---

# 24. PDF Readerが開いている場合

`Add Page` 実行時に対象PDFがZotero PDF Readerで開かれている可能性がある。

Zotero 10について、

- 開いた状態でファイルを置換可能か
- Reader cacheへの影響
- reload API
- Readerを閉じる必要性

を調査する。

安全性を保証できない場合、

```text
Close this PDF before adding a page.
```

として処理を中止してよい。

---

# 25. エラー処理

最低限以下を処理する。

- PDF file not found
- Failed to read PDF
- encrypted/unsupported PDF
- PDF生成失敗
- Attachment登録失敗
- 保存失敗
- Zotero変更通知失敗
- Paper Style metadata破損

失敗時に元PDFを破壊しないこと。

---

# 26. 新規ノート作成テスト

3種類すべてテストする。

## Blank

```text
Create Handwritten Notes
→ Blank
```

確認：

- A4
- 1ページ
- 完全な白紙

## Ruled

```text
Create Handwritten Notes
→ Ruled — 6 mm
```

確認：

- A4
- 横線のみ
- 6 mm間隔
- vector drawing

## Grid

```text
Create Handwritten Notes
→ Grid — 5 mm
```

確認：

- A4
- 縦横線
- 5 mm × 5 mm
- vector drawing

---

# 27. Annotation互換性テスト

各Paper Styleについて、

```text
Page 1
Page 2
Page 3
```

にInk Annotationを作成。

`Add Page` 実行後、

```text
Page 1 → Annotation正常
Page 2 → Annotation正常
Page 3 → Annotation正常
Page 4 → 同じPaper Style
```

となること。

以下を確認：

- Annotationが消えない
- ページが変わらない
- Ink位置がずれない
- Zotero再起動後も正常
- Sync後も正常

---

# 28. iPad同期テスト

```text
1. PCでCreate Handwritten Notes

2. Paper StyleとしてGrid 5 mmを選択

3. Sync

4. iPadで開く

5. Apple Pencilで書く

6. Sync

7. PCでInkを確認

8. PCでAdd Page

9. Sync

10. iPadで再読み込み

11. Page 2がGrid 5 mmであることを確認

12. Page 1のInkが維持されていることを確認

13. Page 2へ書く

14. Sync

15. PCで確認
```

Blank / Ruledについても同様に確認する。

---

# 29. 同期に関する設計意図

基本構造：

```text
PDF
+
Zotero Ink Annotation
```

普段：

```text
Apple Pencil
↓
Ink Annotation
↓
Annotation同期
```

ページ追加時のみ：

```text
Add Page
↓
PDF更新
↓
File Sync
```

その後は再びAnnotation同期のみとなる。

---

# 30. manifest.json

正式サポート：

```text
Zotero 10.x
```

概ね、

```json
{
  "applications": {
    "zotero": {
      "id": "<plugin-id>",
      "strict_min_version": "10.0",
      "strict_max_version": "10.0.*"
    }
  }
}
```

とする。

実際の形式は実装時点のZotero公式仕様を確認する。

---

# 31. 初期バージョンで実装しないもの

- ページ削除
- ページ並べ替え
- 任意位置への挿入
- ページ複製
- PDF結合/分割
- Annotation編集
- Annotation flatten
- Annotationコピー
- Undo
- 複数アイテム一括処理
- iPad用プラグイン
- 任意罫線間隔設定
- 任意罫線色設定
- 任意余白設定
- Dot Grid

初期Paper Styleは、

```text
Blank
Ruled — 6 mm
Grid — 5 mm
```

の3種類に限定する。

---

# 32. GitHub公開

GitHub上でOSSとして公開する。

最低限：

```text
repository/
├── README.md
├── LICENSE
├── addon/
├── scripts/
└── .github/
    └── workflows/
```

実際の構成はZotero 10の現行OSSプラグインを参考に決定する。

---

# 33. README

最低限以下を記載する。

```text
# Zotero Handwritten Notes

## Features

- Create handwritten-note PDFs attached to Zotero items
- Blank paper
- 6 mm ruled paper
- 5 mm grid paper
- Add pages while preserving Zotero annotations
- Designed for iPad + Apple Pencil

## Requirements

## Installation

## Usage

## Paper Styles

### Blank
### Ruled — 6 mm
### Grid — 5 mm

## How It Works

## Sync Behavior

## Compatibility

## Development

## License
```

---

# 34. GitHub Releases

`.xpi` をGitHub Releasesからインストール可能にする。

```text
zotero-handwritten-notes-0.1.0.xpi
```

可能であればGitHub Actionsで、

```text
tag
↓
build
↓
XPI
↓
GitHub Release
```

を自動化する。

---

# 35. 自動アップデート

Zoteroの現行Plugin Update仕様を調査し、GitHub Releasesから自動更新可能な構成を検討する。

推測でupdate manifestを実装しない。

---

# 36. バージョン

初期版：

```text
0.1.0
```

Semantic Versioningを基本とする。

---

# 37. クロスプラットフォーム

対象：

```text
Windows
macOS
Linux
```

OS固有の絶対パス・シェルコマンド等に依存しない。

可能な限りZotero/Mozilla提供APIを使用する。

---

# 38. 類似プロジェクト・先行要望の調査

実装前に、既存の類似プラグインおよびZotero Forum上の関連要望を確認する。

特に以下のカテゴリを調査する。

- Zoteroへの白紙ページ追加
- standalone handwritten notes
- iPad handwriting workflow
- Better Notes等のノート拡張
- pdf-libを使用しているZoteroプラグイン

既存実装からコードを利用する場合はライセンスを必ず確認する。

既存コードを無断コピーしない。

---

# 39. Claude CLIへの実装指示

実装前に現行Zotero 10について調査する。

特に：

1. 最新Zotero 10安定版
2. Plugin Development documentation
3. 公式sample plugin
4. 現行OSSプラグイン
5. Context menu API
6. Stored Attachment API
7. Attachment file path API
8. File Syncへの変更通知
9. PDF Reader API
10. pdf-lib integration
11. AnnotationとPDFページの対応
12. Paper Style metadataの保存方法
13. Paper Style metadataをZotero Syncする方法
14. PDF vector drawing
15. manifest
16. update manifest
17. XPI build
18. GitHub Release

不明なAPIを推測して実装しない。

---

# 40. 完了条件

## Create Handwritten Notes

- 親アイテムから作成できる
- Blank / Ruled 6 mm / Grid 5 mmを選択できる
- 1ページPDFが生成される
- Stored Attachmentになる
- Syncできる
- iPadでInkを書ける

## Add Page

- PDF末尾へ追加できる
- 作成時のPaper Styleを引き継ぐ
- 既存ページを変更しない
- 既存Annotationを維持する
- Syncできる
- iPadで追加ページへ書ける

## Distribution

- Zotero 10.x対応
- `.xpi` を生成可能
- GitHub Releasesで配布可能
- Windows / macOS / Linuxを考慮

---

# 41. 最優先事項

1. 既存Zotero Annotationを破壊しない
2. 論文ごとの手書きノートを簡単に作成できる
3. Blank / Ruled / Gridを選択できる
4. 同じPaper Styleで安全にページ追加できる
5. Zotero Sync + iPad + Apple Pencilのワークフローを維持する
6. GitHubで第三者へ安全に配布できる

初期バージョンでは、

> **Create Handwritten Notes + 3種類のPaper Style + Add Page**

を確実に動作させることを優先する。