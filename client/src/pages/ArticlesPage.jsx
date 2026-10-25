import { Link, Navigate, useParams } from "react-router-dom";
import { BookOpen } from "lucide-react";
import PublicShell from "../components/PublicShell";
import usePageMeta, { plainText } from "../components/usePageMeta";
import { Blocks } from "../docs/Blocks";
import { ARTICLES } from "../docs/articles";

function ArticleList() {
  usePageMeta({
    title: "Articles on getting paid · LedgerWatch",
    description:
      "Practical articles for Nigerian small businesses on payment reminders, WhatsApp messages, invoice schedules, tracking debtors and accepting USDC.",
    path: "/articles",
  });
  return (
    <article className="docs-body">
      <p className="docs-crumb">Articles</p>
      <h1>Getting paid, without the awkwardness</h1>
      <p className="docs-intro">
        Short, practical pieces for small businesses that sell on credit. Each one stands on its own, and none of them
        needs LedgerWatch to be useful.
      </p>
      <ul className="article-list">
        {ARTICLES.map((a) => (
          <li key={a.slug}>
            <Link to={`/articles/${a.slug}`} className="article-link">
              <BookOpen size={18} />
              <span className="article-link-text">
                <strong>{a.title}</strong>
                <span>{plainText(a.intro, 150)}</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </article>
  );
}

function Article({ article }) {
  usePageMeta({
    title: `${article.title} · LedgerWatch`,
    description: plainText(article.intro),
    path: `/articles/${article.slug}`,
  });
  return (
    <article className="docs-body">
      <p className="docs-crumb">
        <Link to="/articles">Articles</Link>
      </p>
      <h1>{article.title}</h1>
      <p className="docs-intro">{article.intro}</p>
      <Blocks blocks={article.blocks} />
    </article>
  );
}

export default function ArticlesPage() {
  const { slug } = useParams();
  const article = slug ? ARTICLES.find((a) => a.slug === slug) : null;
  if (slug && !article) return <Navigate to="/articles" replace />;
  return (
    <PublicShell>
      <div className="article-page">{article ? <Article article={article} /> : <ArticleList />}</div>
    </PublicShell>
  );
}
