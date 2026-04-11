function pageRange(currentPage, totalPages) {
  const pages = new Set([1, totalPages, currentPage, currentPage - 1, currentPage + 1]);
  return [...pages]
    .filter((page) => page >= 1 && page <= totalPages)
    .sort((left, right) => left - right);
}

export default function Paginator({ page, totalPages, onChange }) {
  if (totalPages <= 1) {
    return null;
  }

  const pages = pageRange(page, totalPages);

  return (
    <div className="paginator" role="navigation" aria-label="Paginacja">
      <button type="button" className="btn ghost" disabled={page <= 1} onClick={() => onChange(page - 1)}>
        Poprzednia
      </button>

      {pages.map((pageNumber) => (
        <button
          key={pageNumber}
          type="button"
          className={`btn tiny ${pageNumber === page ? "active" : "ghost"}`}
          onClick={() => onChange(pageNumber)}
          aria-current={pageNumber === page ? "page" : undefined}
        >
          {pageNumber}
        </button>
      ))}

      <button
        type="button"
        className="btn ghost"
        disabled={page >= totalPages}
        onClick={() => onChange(page + 1)}
      >
        Nastepna
      </button>
    </div>
  );
}
