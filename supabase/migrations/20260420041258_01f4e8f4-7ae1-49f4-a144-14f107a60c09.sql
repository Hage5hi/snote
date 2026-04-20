CREATE POLICY "Anyone can delete notes"
ON public.notes
FOR DELETE
TO anon, authenticated
USING (true);