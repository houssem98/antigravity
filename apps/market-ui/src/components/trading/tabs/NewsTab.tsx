import React, { useState, useEffect } from 'react';
import { ExternalLink, Loader, Calendar, User } from 'lucide-react';
import { motion } from 'motion/react';

interface NewsItem {
  id: string;
  title: string;
  description: string;
  url: string;
  source: string;
  published_at: string;
  image?: string;
}

interface NewsTabProps {
  asset: string;
}

export const NewsTab: React.FC<NewsTabProps> = ({ asset }) => {
  const [news, setNews] = useState<NewsItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchNews = async () => {
      try {
        setLoading(true);
        const response = await fetch(
          `https://api.coingecko.com/api/v3/news?language=en`
        );
        if (!response.ok) throw new Error('Failed to fetch news');
        const data = await response.json();

        // Filter news by asset name or use all news
        const filtered = data.data
          .slice(0, 20)
          .map((item: any) => ({
            id: item.id,
            title: item.title,
            description: item.description || item.title,
            url: item.url,
            source: item.source || 'News',
            published_at: item.published_at,
            image: item.image?.thumb || item.image?.small,
          }));

        setNews(filtered);
      } catch (error) {
        console.error('Error fetching news:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchNews();
  }, [asset]);

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffHours / 24);

    if (diffHours < 1) return 'Just now';
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <Loader className="w-6 h-6 text-[color:var(--text-3)] animate-spin" />
      </div>
    );
  }

  return (
    <div className="p-4 space-y-3 overflow-y-auto max-h-[calc(100vh-200px)]">
      {news.length === 0 ? (
        <div className="py-12 text-center text-[color:var(--text-3)]">
          No news available
        </div>
      ) : (
        news.map((item, idx) => (
          <motion.a
            key={item.id}
            href={item.url}
            target="_blank"
            rel="noopener noreferrer"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: idx * 0.05 }}
            className="flex gap-3 p-3 bg-[color:var(--surface)] border border-[color:var(--line)] hover:border-[color:var(--line-strong)] rounded-sm transition-colors group cursor-pointer"
          >
            {item.image && (
              <div className="shrink-0 w-20 h-20 bg-[color:var(--bg)] rounded-sm overflow-hidden border border-[color:var(--line)]">
                <img
                  src={item.image}
                  alt={item.title}
                  className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                />
              </div>
            )}
            <div className="flex-1 min-w-0">
              <h3 className="text-body font-semibold text-[color:var(--text)] group-hover:text-[color:var(--accent)] transition-colors line-clamp-2">
                {item.title}
              </h3>
              <p className="text-label text-[color:var(--text-3)] mt-1 line-clamp-2">
                {item.description}
              </p>
              <div className="flex items-center gap-3 mt-2 text-label text-[color:var(--text-4)]">
                <div className="flex items-center gap-1">
                  <Calendar className="w-3 h-3" />
                  {formatDate(item.published_at)}
                </div>
                <span className="text-[color:var(--text-3)]">{item.source}</span>
                <ExternalLink className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity ml-auto" />
              </div>
            </div>
          </motion.a>
        ))
      )}
    </div>
  );
};
