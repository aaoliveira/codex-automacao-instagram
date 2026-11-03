import { Image as ImageIcon } from 'lucide-react';
import { MediaLibraryBrowser } from '@/components/media/media-library-browser';

export default function MediaLibraryPage() {
  return (
    <div className="space-y-7 sm:space-y-8">
      <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
        <div>
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.13em] text-indigo-600">Content workspace</p>
          <h1 className="flex items-center gap-3 text-[28px] font-semibold tracking-[-0.04em] text-slate-950 sm:text-[34px]">
            Media library<span className="text-indigo-600">.</span>
            <ImageIcon className="hidden size-6 text-indigo-500 sm:block" aria-hidden="true" />
          </h1>
          <p className="mt-2 max-w-xl text-sm leading-6 text-slate-500">
            Keep your organization’s photos and videos together, preview files, then send one to the Composer.
          </p>
        </div>
        <span className="inline-flex h-9 items-center self-start rounded-full border border-indigo-100 bg-indigo-50 px-3 text-[10px] font-semibold uppercase tracking-wide text-indigo-700 sm:self-auto">Organization library</span>
      </div>
      <MediaLibraryBrowser />
    </div>
  );
}
